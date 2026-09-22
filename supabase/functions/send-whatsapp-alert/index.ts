import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireAuthorizedUser } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { claimSendSlot, releaseSendSlot } from "../_shared/rateLimit.ts";

// Sends a WhatsApp message using the stored credentials.
// whatsapp_config.access_token is expected to be a PERMANENT Meta
// Business System User token; no refresh flow here, none needed.
//
// SECURITY HARDENING (2026-09-22):
// - now gated -- this was the project's clearest abuse vector: an
//   unauthenticated caller could supply an arbitrary `to` and make the
//   business's real WhatsApp number message any phone number. Requiring
//   an authorized session closes most of that by itself.
// - a generic per-user rate limit is added as defense-in-depth in case a
//   session token ever leaks, independent of the shipment-specific
//   cooldown on request-tracking-update (this function isn't shipment-
//   scoped).
// - recipient is validated as a plausible phone number server-side
//   before any send.

const MAX_SENDS_PER_HOUR = 10;
const FUNCTION_NAME = "send-whatsapp-alert";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handlePreflight(req);
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST only" }), { status: 405, headers: corsHeaders(req) });
  }

  const auth = await requireAuthorizedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode === "text" ? "text" : "template";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // RACE-SAFETY (2026-09-23): atomic claim (see request-tracking-update
    // for the same pattern) -- a count-then-insert here had the same
    // TOCTOU gap two rapid-fire requests from one session could slip
    // through.
    let claimId: number | null = null;
    {
      const claim = await claimSendSlot(supabase, FUNCTION_NAME, null, auth.user.id, 60, MAX_SENDS_PER_HOUR);
      if (!claim.allowed) {
        return new Response(
          JSON.stringify({ ok: false, error: `Rate limit: at most ${MAX_SENDS_PER_HOUR} WhatsApp sends per hour per user.` }),
          { status: 429, headers: corsHeaders(req) },
        );
      }
      claimId = claim.claimId;
    }

    const { data: config, error: configError } = await supabase
      .from("whatsapp_config")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (configError) throw configError;
    if (!config) throw new Error("No whatsapp_config row found");

    const to = String(body.to || config.test_recipient_number || "").replace(/\D/g, "");
    if (!to) throw new Error("No recipient: pass 'to' or set test_recipient_number in whatsapp_config");
    if (!/^\d{8,15}$/.test(to)) throw new Error("Recipient must be a plausible phone number (8-15 digits, country code first)");

    let payload: Record<string, unknown>;
    if (mode === "text") {
      if (!body.text) throw new Error("mode:'text' requires a 'text' field");
      payload = { messaging_product: "whatsapp", to, type: "text", text: { body: String(body.text).slice(0, 4096) } };
    } else {
      payload = {
        messaging_product: "whatsapp", to, type: "template",
        template: { name: "hello_world", language: { code: "en_US" } },
      };
    }

    console.log(`send-whatsapp-alert: mode=${mode} by user=${auth.user.id}`);

    const waRes = await fetch(`https://graph.facebook.com/v25.0/${config.phone_number_id}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const waJson = await waRes.json();
    if (!waRes.ok) {
      await releaseSendSlot(supabase, claimId); // don't burn a rate-limit slot on a real failure
      if (waJson?.error?.code === 190) {
        throw new Error(
          `WhatsApp access token rejected as invalid (Graph API error 190): ${JSON.stringify(waJson.error)}. ` +
          `With a permanent System User token this should not happen from normal expiry -- check whether the ` +
          `token was revoked, the System User was removed, or the app/WABA asset permissions changed in Meta Business Suite.`
        );
      }
      throw new Error(`WhatsApp API returned ${waRes.status}: ${JSON.stringify(waJson)}`);
    }

    return new Response(JSON.stringify({ ok: true, mode, to, whatsappResponse: waJson }), { headers: corsHeaders(req) });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 502, headers: corsHeaders(req) });
  }
});
