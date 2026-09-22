import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireAuthorizedUser } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";

// Driver/provider WhatsApp tracking agent: inserts one shipment row from
// the dashboard's "Add shipment" form.
//
// SECURITY HARDENING (2026-09-22): now gated -- anyone could previously
// create shipment records (a real driver phone number ends up contacted
// via request-tracking-update once one exists).

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handlePreflight(req);
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST only" }), { status: 405, headers: corsHeaders(req) });
  }

  const auth = await requireAuthorizedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const driverName = String(body.driverName || "").trim();
    const driverPhone = String(body.driverPhone || "").replace(/\D/g, "");
    const description = String(body.description || "").trim();
    const deadline = body.deadline ? new Date(body.deadline).toISOString() : null;

    if (!driverName) throw new Error("driverName is required");
    if (!driverPhone || driverPhone.length < 8 || driverPhone.length > 15) {
      throw new Error("driverPhone is required (digits, country code first, 8-15 digits)");
    }
    if (!description) throw new Error("description is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await supabase
      .from("shipments")
      .insert({ driver_name: driverName, driver_phone: driverPhone, description, deadline })
      .select("id, driver_name, driver_phone, description, deadline, status, created_at")
      .single();
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, shipment: data }), { headers: corsHeaders(req) });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 400, headers: corsHeaders(req) });
  }
});
