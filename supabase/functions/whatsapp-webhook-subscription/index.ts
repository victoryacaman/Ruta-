import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireAuthorizedUser } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";

// Diagnostic/fix for a well-known WhatsApp Cloud API gotcha: registering
// the app's webhook callback URL (verify_token handshake) is a SEPARATE
// thing from the WhatsApp Business Account actually being subscribed to
// send this app events. GET checks current subscribed apps on the WABA;
// POST subscribes it (idempotent — safe to call more than once). Never
// returns the access token, only Meta's own subscription-status response.
//
// SECURITY HARDENING (2026-09-23): this is an administrative action --
// POST changes the WABA's webhook subscription -- so it now requires an
// authorized Utopia session, same as every other config-changing
// endpoint in this project.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handlePreflight(req);

  const auth = await requireAuthorizedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: config, error } = await supabase
      .from("whatsapp_config")
      .select("whatsapp_business_account_id, access_token")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!config) throw new Error("No whatsapp_config row found");

    const url = `https://graph.facebook.com/v25.0/${config.whatsapp_business_account_id}/subscribed_apps`;
    const waRes = await fetch(url, {
      method: req.method === "POST" ? "POST" : "GET",
      headers: { "Authorization": `Bearer ${config.access_token}` },
    });
    const waJson = await waRes.json();

    return new Response(
      JSON.stringify({ ok: waRes.ok, status: waRes.status, response: waJson }),
      { status: waRes.ok ? 200 : 502, headers: corsHeaders(req) },
    );
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 502, headers: corsHeaders(req) });
  }
});
