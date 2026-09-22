import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireAuthorizedUser } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";

// Driver/provider WhatsApp tracking agent: read-only relay over the
// locked-down shipments table.
//
// SECURITY HARDENING (2026-09-22): now gated -- this returned every
// shipment's driver name/phone and free-text reply content to any
// anonymous caller before, a real PII exposure.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handlePreflight(req);

  const auth = await requireAuthorizedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await supabase
      .from("shipments")
      .select("id, driver_name, driver_phone, description, deadline, status, tracking_number, carrier_eta, last_driver_message, last_contacted_at, last_response_at, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return new Response(JSON.stringify({ ok: true, shipments: data }), { headers: corsHeaders(req) });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 502, headers: corsHeaders(req) });
  }
});
