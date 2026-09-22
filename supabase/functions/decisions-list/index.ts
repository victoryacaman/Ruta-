import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireAuthorizedUser } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { computeDecisionMetrics, type EventSummary, type SnapshotSummary } from "./metrics.ts";

// Decisions view: read-only relay joining risk_snapshots with
// recommendation_events so the dashboard can show a real history.
//
// SECURITY HARDENING (2026-09-22): now gated -- this exposed real
// exposure/ROI figures and severity history to any anonymous caller
// before.
//
// DATA INTEGRITY (2026-09-22, Part C): metrics default to `environment
// = 'pilot'` and always exclude `computation_source = 'test'` --
// otherwise a page reload with nothing new to show, or someone just
// looking at the demo, would count the same as a real pilot decision.
// Pass ?scope=all to include demo/development/unknown rows too (for
// exploring engagement pre-pilot); the response always says which scope
// was used and whether non-pilot data is included, so the dashboard can
// disclose it rather than blend it in silently. "Recommendations shown"
// is the count of DISTINCT applicable recommendation situations (after
// risk-recommendation's dedup -- see fingerprint.ts), not raw page-load
// repeats of the same undecided one.

const HISTORY_LIMIT = 50;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handlePreflight(req);

  const auth = await requireAuthorizedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(req.url);
    const scope = url.searchParams.get("scope") === "all" ? "all" : "pilot";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let query = supabase
      .from("risk_snapshots")
      .select("id, computed_at, severity, erp_provider, recommendation_applicable, total_exposure_lps, total_transfer_cost_lps, roi_multiple, sku_count, environment, computation_source, computation_count")
      .neq("computation_source", "test") // never counts anywhere, regardless of scope
      .order("computed_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    if (scope === "pilot") query = query.eq("environment", "pilot");

    const { data: snapshots, error: snapError } = await query;
    if (snapError) throw snapError;

    const snapshotIds = (snapshots ?? []).map((s) => s.id);
    let events: any[] = [];
    if (snapshotIds.length) {
      const { data: eventRows, error: eventError } = await supabase
        .from("recommendation_events")
        .select("snapshot_id, event_type, created_at")
        .in("snapshot_id", snapshotIds)
        .order("created_at", { ascending: true });
      if (eventError) throw eventError;
      events = eventRows ?? [];
    }

    const latestEventBySnapshot = new Map<string, { event_type: string; created_at: string }>();
    for (const ev of events) {
      latestEventBySnapshot.set(ev.snapshot_id, { event_type: ev.event_type, created_at: ev.created_at });
    }

    const history = (snapshots ?? []).map((s) => {
      const latest = latestEventBySnapshot.get(s.id);
      let status: string;
      if (!s.recommendation_applicable) status = "not_applicable";
      else if (latest?.event_type === "approved") status = "approved";
      else if (latest?.event_type === "dismissed") status = "dismissed";
      else status = "no_action";
      return {
        id: s.id,
        computedAt: s.computed_at,
        severity: s.severity,
        erpProvider: s.erp_provider,
        recommendationApplicable: s.recommendation_applicable,
        totalExposureLps: s.total_exposure_lps,
        totalTransferCostLps: s.total_transfer_cost_lps,
        roiMultiple: s.roi_multiple,
        skuCount: s.sku_count,
        environment: s.environment,
        computationSource: s.computation_source,
        computationCount: s.computation_count,
        status,
        decidedAt: latest?.created_at ?? null,
      };
    });

    const snapshotSummaries: SnapshotSummary[] = (snapshots ?? []).map((s) => ({
      id: s.id, recommendationApplicable: s.recommendation_applicable,
    }));
    const eventSummaries: EventSummary[] = events.map((e) => ({
      snapshotId: e.snapshot_id, eventType: e.event_type, createdAt: e.created_at,
    }));
    const metrics = computeDecisionMetrics(snapshotSummaries, eventSummaries);
    const calculationsPerformed = (snapshots ?? []).reduce((s, x) => s + (x.computation_count ?? 1), 0);
    const demoDataIncluded = (snapshots ?? []).some((s) => s.environment !== "pilot");

    return new Response(
      JSON.stringify({
        ok: true,
        fetchedAt: new Date().toISOString(),
        scope,
        demoDataIncluded,
        summary: {
          calculationsPerformed,
          totalSnapshots: (snapshots ?? []).length,
          applicableRecommendations: metrics.distinctApplicableRecommendations,
          recommendationsShown: metrics.distinctApplicableRecommendations,
          actedUpon: metrics.actedUpon,
          approved: metrics.approved,
          dismissed: metrics.dismissed,
          noAction: metrics.noAction,
          undoneEventCount: metrics.undoneEventCount,
          decisionCoveragePct: metrics.decisionCoveragePct,
          approvalRatePct: metrics.approvalRatePct,
        },
        history,
      }),
      { headers: corsHeaders(req) },
    );
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 502, headers: corsHeaders(req) });
  }
});
