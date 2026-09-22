import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireAuthorizedUser } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { isShipmentInCooldown, logSend } from "../_shared/rateLimit.ts";

// Driver/provider WhatsApp tracking agent: sends the approved
// tracking_request template to a shipment's driver, asking for a tracking
// number or ETA. Manually triggered from the dashboard, never automatic.
//
// SECURITY HARDENING (2026-09-22):
// - now gated (was fully unauthenticated -- anyone who knew a shipment id
//   could make the business's real WhatsApp number message a real driver).
// - a per-shipment cooldown (default 60 min) blocks a repeat send for the
//   same shipment unless the caller explicitly passes {confirmResend:true}
//   -- the caller is already a known, authorized user at that point, so
//   this is a deliberate "yes, send it again" override, not an open door.
// - recipient/shipment are validated server-side before any send.

const RESEND_COOLDOWN_MINUTES = 60;
const FUNCTION_NAME = "request-tracking-update";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handlePreflight(req);
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST only" }), { status: 405, headers: corsHeaders(req) });
  }

  const auth = await requireAuthorizedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const shipmentId = body.shipmentId;
    const confirmResend = body.confirmResend === true;
    if (!shipmentId || typeof shipmentId !== "string") throw new Error("shipmentId is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: shipment, error: shipmentError } = await supabase
      .from("shipments")
      .select("id, driver_name, driver_phone, description")
      .eq("id", shipmentId)
      .maybeSingle();
    if (shipmentError) throw shipmentError;
    if (!shipment) {
      return new Response(JSON.stringify({ ok: false, error: "No shipment found for that id" }), { status: 404, headers: corsHeaders(req) });
    }
    if (!shipment.driver_phone || !/^\d{8,15}$/.test(shipment.driver_phone)) {
      return new Response(JSON.stringify({ ok: false, error: "Shipment has no valid driver_phone on file" }), { status: 400, headers: corsHeaders(req) });
    }

    if (!confirmResend) {
      const inCooldown = await isShipmentInCooldown(supabase, FUNCTION_NAME, shipmentId, RESEND_COOLDOWN_MINUTES);
      if (inCooldown) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: `A tracking request was already sent for this shipment in the last ${RESEND_COOLDOWN_MINUTES} minutes. Pass confirmResend:true to send again anyway.`,
            cooldownMinutes: RESEND_COOLDOWN_MINUTES,
          }),
          { status: 429, headers: corsHeaders(req) },
        );
      }
    }

    const { data: config, error: configError } = await supabase
      .from("whatsapp_config")
      .select("phone_number_id, access_token")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (configError) throw configError;
    if (!config) throw new Error("No whatsapp_config row found");

    const payload = {
      messaging_product: "whatsapp",
      to: shipment.driver_phone,
      type: "template",
      template: {
        name: "tracking_request",
        language: { code: "es" },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: shipment.driver_name },
            { type: "text", text: shipment.description },
          ],
        }],
      },
    };

    console.log(`request-tracking-update: sending to shipment ${shipmentId} (confirmResend=${confirmResend})`);

    const waRes = await fetch(`https://graph.facebook.com/v25.0/${config.phone_number_id}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${config.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const waJson = await waRes.json();

    if (!waRes.ok) {
      const msg = waJson?.error?.message || "";
      const isTemplateIssue = /template/i.test(msg) || waJson?.error?.error_subcode === 132001 || waJson?.error?.code === 132000;
      const error = isTemplateIssue
        ? `tracking_request template not available yet (pending Meta approval or not yet created): ${msg}`
        : `WhatsApp API returned ${waRes.status}: ${JSON.stringify(waJson)}`;
      return new Response(JSON.stringify({ ok: false, error }), { status: 502, headers: corsHeaders(req) });
    }

    await supabase.from("shipments").update({
      status: "tracking_requested",
      last_contacted_at: new Date().toISOString(),
    }).eq("id", shipmentId);
    await logSend(supabase, FUNCTION_NAME, shipmentId, auth.user?.id ?? null);

    return new Response(JSON.stringify({ ok: true, whatsappResponse: waJson }), { headers: corsHeaders(req) });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 502, headers: corsHeaders(req) });
  }
});
