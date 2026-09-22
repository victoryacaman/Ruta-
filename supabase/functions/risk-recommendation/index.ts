import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireAuthorizedUser } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { computeAtRiskSkus } from "./scoring.ts";
import { computeSignalFingerprint } from "./fingerprint.ts";

// Build order step 4: rule-based scoring engine. Combines step 2's live
// weather/storm signal with step 3's ERP inventory data into a real
// "inventory at risk" number and ranked recommendation.
//
// SECURITY HARDENING (2026-09-22): the response includes real ERP-derived
// data (atRiskSkus[].sku/name/onHandUnits/...) once a real ERP/Excel is
// connected, so this is now gated the same as erp-inventory. storm-signal
// stays unauthenticated since it returns no customer data at all.
//
// INTERNAL AUTH REVIEW (2026-09-23): the internal call to erp-inventory
// forwards the ORIGINAL caller's own Authorization header rather than
// this project's service_role key -- erp-inventory verifies that real
// end-user the same way a direct call would (see _shared/auth.ts for why
// the service_role bypass was removed). This means an unauthorized
// caller can't reach erp-inventory's data through this function either,
// and no broad internal credential travels between functions at all.
//
// DATA INTEGRITY (2026-09-22): the per-SKU exposure/transfer math and the
// conservative-transfer verification logic now live in scoring.ts, as
// pure, independently unit-tested functions -- see
// tests/unit/scoring_test.ts. This file just wires that output into the
// response and, below, into a deduplicated risk_snapshots row (Part C).

const DEFAULT_LOCATION = { locationName: "Puerto Cortés", lat: 15.8267, lon: -87.9536, relevantRadiusKm: 2500, transferCostPerUnitLps: 45 };
const SEVERE_WEATHER_CODES = [65, 82, 95, 96, 99];
const HEAVY_RAIN_MM = 20;
const HIGH_WIND_KMH = 40;
const EXPECTED_DELAY_DAYS: Record<string, number> = { unknown: 0, low: 0, medium: 5, high: 10 };

const STORM_SIGNAL_URL = "https://gcrnarueiybbavmkzhcv.supabase.co/functions/v1/storm-signal";
const ERP_INVENTORY_URL = "https://gcrnarueiybbavmkzhcv.supabase.co/functions/v1/erp-inventory";

function supabaseClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function loadLocationConfig() {
  try {
    const supabase = supabaseClient();
    const { data, error } = await supabase
      .from("risk_location_config")
      .select("location_name, lat, lon, relevant_radius_km, transfer_cost_per_unit_lps")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !data) throw error ?? new Error("no risk_location_config row");
    return {
      locationName: data.location_name, lat: data.lat, lon: data.lon,
      relevantRadiusKm: data.relevant_radius_km,
      transferCostPerUnitLps: Number(data.transfer_cost_per_unit_lps),
    };
  } catch (_err) {
    return DEFAULT_LOCATION;
  }
}

async function fetchWeatherOutlook(lat: number, lon: number) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=precipitation_sum,windspeed_10m_max,weathercode&timezone=auto&forecast_days=7`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
  const data = await res.json();
  const daily = data.daily ?? {};
  const flaggedDays: any[] = [];
  const allDays: any[] = [];
  for (let i = 0; i < (daily.time || []).length; i++) {
    const code = daily.weathercode[i];
    const precip = daily.precipitation_sum[i];
    const wind = daily.windspeed_10m_max[i];
    const flagged = SEVERE_WEATHER_CODES.includes(code) || precip > HEAVY_RAIN_MM || wind > HIGH_WIND_KMH;
    const day = { date: daily.time[i], code, precip, wind, flagged };
    allDays.push(day);
    if (flagged) flaggedDays.push(day);
  }
  return { flaggedDays, allDays, daysChecked: (daily.time || []).length };
}

function computeSeverity(flaggedDays: any[], relevantStorms: any[], weatherFailed: boolean, stormsFailed: boolean, locationName: string, relevantRadiusKm: number) {
  if (weatherFailed && stormsFailed) {
    return { severity: "unknown", reasons: ["Both live feeds failed to load — severity cannot be determined right now"] };
  }
  let severity = "low";
  const reasons: string[] = [];
  if (flaggedDays.length > 0) {
    severity = "medium";
    reasons.push(`${flaggedDays.length} day(s) of forecasted heavy rain, thunderstorms, or high wind in the next 7 days`);
  }
  if (relevantStorms.length > 0) {
    severity = "medium";
    reasons.push(`${relevantStorms.length} active tropical system(s) within ${relevantRadiusKm.toLocaleString("en-US")}km of ${locationName}`);
    const imminent = relevantStorms.some((s) => s.classification === "HU" || s.classification === "MH" || s.distanceKm < 500);
    if (imminent) severity = "high";
  }
  return { severity, reasons };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handlePreflight(req);

  const auth = await requireAuthorizedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(req.url);
    const requestedSource = url.searchParams.get("source");
    const computationSource = (["page_load", "manual_refresh", "scheduled", "test"].includes(requestedSource ?? "")
      ? requestedSource
      : "page_load") as "page_load" | "manual_refresh" | "scheduled" | "test";

    const location = await loadLocationConfig();
    // Forward the caller's own bearer token, not a broad internal
    // credential -- erp-inventory independently re-verifies this same
    // real user (see the INTERNAL AUTH REVIEW note above).
    const callerAuthHeader = req.headers.get("authorization") ?? "";

    const [weatherResult, stormsResult, erpResult] = await Promise.allSettled([
      fetchWeatherOutlook(location.lat, location.lon),
      fetch(STORM_SIGNAL_URL).then((r) => r.json()),
      fetch(ERP_INVENTORY_URL, { headers: { Authorization: callerAuthHeader } }).then((r) => r.json()),
    ]);

    const weatherFailed = weatherResult.status !== "fulfilled";
    const weather: { flaggedDays: any[]; allDays: any[]; daysChecked: number; error: string | null } = weatherResult.status === "fulfilled"
      ? { ...weatherResult.value, error: null }
      : { flaggedDays: [], allDays: [], daysChecked: 0, error: String((weatherResult as PromiseRejectedResult).reason) };

    const stormsRaw = stormsResult.status === "fulfilled" ? stormsResult.value : null;
    const stormsFailed = !(stormsRaw?.ok);
    const storms = stormsRaw?.ok
      ? stormsRaw
      : { relevantStorms: [], relevantRadiusKm: location.relevantRadiusKm, error: stormsRaw?.error ?? String((stormsResult as PromiseRejectedResult).reason ?? "storm-signal unavailable") };

    const erpRaw = erpResult.status === "fulfilled" ? erpResult.value : null;
    const erp = erpRaw?.ok
      ? erpRaw
      : { items: [], provider: "unknown", error: erpRaw?.error ?? String((erpResult as PromiseRejectedResult).reason ?? "erp-inventory unavailable") };

    const { severity, reasons } = computeSeverity(
      weather.flaggedDays, storms.relevantStorms ?? [], weatherFailed, stormsFailed,
      location.locationName, storms.relevantRadiusKm ?? location.relevantRadiusKm,
    );
    const expectedDelayDays = EXPECTED_DELAY_DAYS[severity];

    const scoring = computeAtRiskSkus(erp.items ?? [], expectedDelayDays, location.transferCostPerUnitLps);

    const recommendation = scoring.applicable
      ? {
        applicable: true,
        atRiskSkus: scoring.atRiskSkus,
        totalExposureLps: scoring.totalExposureLps,
        exposureIncomplete: scoring.exposureIncomplete,
        totalTransferCostLps: scoring.totalTransferCostLps,
        totalTransferUnits: scoring.totalTransferUnits,
        totalVerifiedTransferUnits: scoring.totalVerifiedTransferUnits,
        anyUnverifiedTransfers: scoring.anyUnverifiedTransfers,
        roiMultiple: scoring.roiMultiple,
        roiUnavailableReason: scoring.roiUnavailableReason,
        avgCoveragePct: scoring.avgCoveragePct,
        topWarehouse: scoring.topWarehouse,
        transferCostAssumptionLpsPerUnit: location.transferCostPerUnitLps,
      }
      : { applicable: false };

    // Part C: classify which "bucket" this computation belongs to, from
    // the actual ERP provider in use -- not asked of the caller, since
    // the caller (the dashboard) has no more insight into this than the
    // server does. 'unknown' covers erp-inventory itself being
    // unreachable, matching the same "say so, don't guess" rule this
    // project applies everywhere else.
    const erpProvider = erp.provider ?? "unknown";
    const environment: "demo" | "pilot" | "unknown" =
      erpProvider === "demo" ? "demo" : erpProvider === "unknown" ? "unknown" : "pilot";

    const responseBody = {
      ok: true,
      computedAt: new Date().toISOString(),
      locationName: location.locationName,
      corridor: {
        severity, reasons,
        flaggedWeatherDays: weather.flaggedDays.length,
        weatherDays: weather.allDays ?? [],
        relevantStorms: storms.relevantStorms ?? [],
        relevantRadiusKm: storms.relevantRadiusKm ?? location.relevantRadiusKm,
        expectedDelayDays,
        weatherError: weather.error ?? null,
        stormError: storms.error ?? null,
      },
      erpProvider,
      erpError: erp.error ?? null,
      recommendation,
      environment,
      computationSource,
    };

    const signalFingerprint = await computeSignalFingerprint({
      locationName: location.locationName,
      severity,
      expectedDelayDays,
      erpProvider,
      atRiskSkus: scoring.atRiskSkus.map((s) => ({ sku: s.sku, unitsShort: s.unitsShort, transferUnits: s.transferUnits })),
    });

    // Dedup: a repeat of the exact same material recommendation within
    // a short window (nothing that actually drives the recommendation
    // has changed) increments the existing row's computation_count
    // instead of inserting a new one -- see BUILD_LOG.md/Part C. This is
    // what keeps "recommendations shown" from being inflated by someone
    // just reloading the dashboard.
    const DEDUP_WINDOW_MINUTES = 5;
    let snapshotId: string | null = null;
    try {
      const supabase = supabaseClient();
      const since = new Date(Date.now() - DEDUP_WINDOW_MINUTES * 60_000).toISOString();
      const { data: existing, error: existingError } = await supabase
        .from("risk_snapshots")
        .select("id, computation_count")
        .eq("signal_fingerprint", signalFingerprint)
        .gte("computed_at", since)
        .order("computed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingError) throw existingError;

      if (existing) {
        const { error: updateError } = await supabase
          .from("risk_snapshots")
          .update({ computation_count: (existing.computation_count ?? 1) + 1, last_computed_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (updateError) throw updateError;
        snapshotId = existing.id;
      } else {
        const { data, error } = await supabase.from("risk_snapshots").insert({
          computed_at: responseBody.computedAt,
          severity,
          erp_provider: erpProvider,
          recommendation_applicable: recommendation.applicable,
          total_exposure_lps: scoring.totalExposureLps,
          total_transfer_cost_lps: recommendation.applicable ? scoring.totalTransferCostLps : null,
          roi_multiple: scoring.roiMultiple,
          sku_count: recommendation.applicable ? scoring.atRiskSkus.length : 0,
          full_response: responseBody,
          environment,
          computation_source: computationSource,
          signal_fingerprint: signalFingerprint,
          computation_count: 1,
          last_computed_at: responseBody.computedAt,
        }).select("id").single();
        if (error) throw error;
        snapshotId = data.id;
      }
    } catch (persistErr) {
      console.error("Failed to persist/dedup risk snapshot:", persistErr);
    }

    return new Response(
      JSON.stringify({ ...responseBody, snapshotId, signalFingerprint }),
      { headers: corsHeaders(req) },
    );
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 502, headers: corsHeaders(req) });
  }
});
