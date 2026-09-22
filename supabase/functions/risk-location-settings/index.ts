import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireAuthorizedUser } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";

// Backs the dashboard's Settings view. GET reads the current
// risk_location_config row; POST updates it.
//
// SECURITY HARDENING (2026-09-22): now gated (previously unauthenticated
// by design, since this table holds no credentials -- still true, but
// "changes configuration" is explicitly in scope for this pass). Also
// tightened POST validation: relevantRadiusKm is now bounds-checked
// (previously accepted any value including negative/absurd numbers), and
// currencyCode is checked against a real ISO 4217-shaped pattern instead
// of just being length-capped.

const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handlePreflight(req);

  const auth = await requireAuthorizedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const locationName = String(body.locationName || "").trim();
      const lat = Number(body.lat);
      const lon = Number(body.lon);
      const relevantRadiusKm = Number(body.relevantRadiusKm) || 2500;
      const currencyCode = String(body.currencyCode || "HNL").trim().toUpperCase();
      const currencySymbol = String(body.currencySymbol || "L").trim().slice(0, 5) || "L";

      if (!locationName) throw new Error("locationName is required");
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error("lat must be a number between -90 and 90");
      if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error("lon must be a number between -180 and 180");
      if (!Number.isFinite(relevantRadiusKm) || relevantRadiusKm <= 0 || relevantRadiusKm > 20000) {
        throw new Error("relevantRadiusKm must be a number between 1 and 20000");
      }
      if (!CURRENCY_CODE_RE.test(currencyCode)) throw new Error("currencyCode must be a 3-letter code, e.g. HNL, USD");

      const { data: existing } = await supabase.from("risk_location_config").select("id").order("created_at", { ascending: true }).limit(1).maybeSingle();
      let result;
      if (existing) {
        result = await supabase.from("risk_location_config")
          .update({ location_name: locationName, lat, lon, relevant_radius_km: relevantRadiusKm, currency_code: currencyCode, currency_symbol: currencySymbol, updated_at: new Date().toISOString() })
          .eq("id", existing.id).select().single();
      } else {
        result = await supabase.from("risk_location_config")
          .insert({ location_name: locationName, lat, lon, relevant_radius_km: relevantRadiusKm, currency_code: currencyCode, currency_symbol: currencySymbol }).select().single();
      }
      if (result.error) throw result.error;
      return new Response(JSON.stringify({ ok: true, config: result.data }), { headers: corsHeaders(req) });
    }

    const { data, error } = await supabase.from("risk_location_config").select("location_name, lat, lon, relevant_radius_km, currency_code, currency_symbol, updated_at").order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (error) throw error;
    return new Response(JSON.stringify({ ok: true, config: data }), { headers: corsHeaders(req) });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 400, headers: corsHeaders(req) });
  }
});
