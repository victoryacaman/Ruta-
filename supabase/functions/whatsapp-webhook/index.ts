import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { verifyMetaSignature } from "../_shared/crypto.ts";

// Driver/provider WhatsApp tracking agent: the first INBOUND surface in
// this project (everything else is outbound-only). Meta calls this
// twice: GET to verify the webhook (echo hub.challenge if hub.verify_token
// matches whatsapp_config.webhook_verify_token), POST to deliver inbound
// messages/status updates.
//
// PUBLIC EXTERNAL CALLBACK, PROTOCOL-VERIFIED (2026-09-23): unauthenticated
// by design -- Meta itself is the caller and has no way to send our own
// Supabase auth header. Real access control on POST is Meta's own
// X-Hub-Signature-256, an HMAC-SHA256 of the raw body keyed on
// whatsapp_config.meta_app_secret (set via Meta App Dashboard -> Basic
// Settings -> App Secret, same secret used to sign every webhook this
// app receives). Verified BEFORE any JSON.parse, against the untouched
// raw body bytes -- Meta signs the bytes it sent, not a re-serialized
// object, so parsing first and re-stringifying would make the signature
// unverifiable. Rejected before any body parsing or DB write.
//
// IDEMPOTENCY: Meta retries a webhook delivery on anything but a prompt
// 2xx, so the same message can arrive more than once. whatsapp_webhook_
// events (message_id primary key) is written durably BEFORE we ack --
// a duplicate delivery finds its row already there (0 rows inserted) and
// is ack'd without reprocessing; a genuine DB failure on that first write
// returns 500 so Meta retries instead of silently dropping the message.
// Only once that record exists do we do the "nice to have" driver-reply
// matching -- a bug in that logic is logged but never turns into a 500,
// since the message is already durably recorded and re-delivery wouldn't
// fix it, it would just double the noise.
//
// Always returns 200 on POST once the message is durably recorded (even
// if the driver-reply matching that follows hits an internal error,
// logged server-side instead) because Meta disables a webhook that
// fails/times out repeatedly.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-hub-signature-256",
  "Content-Type": "application/json; charset=utf-8",
};

function supabaseClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// Simple heuristic, not NLP: a short token-like string (letters/digits/
// dashes, no spaces) reads as a tracking code. Anything else (a sentence,
// an ETA like "llego en 2 horas") is still recorded as the driver's reply,
// just not copied into tracking_number. Documented as a pilot-speed
// limitation in CLAUDE.md.
const TRACKING_CODE_RE = /^[A-Za-z0-9-]{5,20}$/;

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    try {
      const supabase = supabaseClient();
      const { data } = await supabase.from("whatsapp_config").select("webhook_verify_token").limit(1).maybeSingle();
      if (mode === "subscribe" && data?.webhook_verify_token && token === data.webhook_verify_token) {
        return new Response(challenge ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
      }
    } catch (_err) {
      // fall through to 403
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method === "POST") {
    // Raw text FIRST -- the signature is computed over these exact bytes.
    const rawBody = await req.text();
    const supabase = supabaseClient();

    const { data: config, error: configError } = await supabase
      .from("whatsapp_config")
      .select("meta_app_secret")
      .limit(1)
      .maybeSingle();
    if (configError) {
      console.error("whatsapp-webhook: could not load meta_app_secret:", configError.message);
      return new Response(JSON.stringify({ ok: false, error: "Server error" }), { status: 500, headers: corsHeaders });
    }

    const signatureHeader = req.headers.get("x-hub-signature-256");
    const validSignature = await verifyMetaSignature(rawBody, signatureHeader, config?.meta_app_secret);
    if (!validSignature) {
      console.warn("whatsapp-webhook: rejected POST with missing/invalid X-Hub-Signature-256");
      return new Response(JSON.stringify({ ok: false, error: "Invalid signature" }), { status: 401, headers: corsHeaders });
    }

    const payload = JSON.parse(rawBody || "{}");
    const value = payload?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    const messageId: string | undefined = message?.id;

    if (!message || !messageId) {
      // Nothing to dedup or process (e.g. a status/read-receipt callback).
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    // Durable write BEFORE ack: ignoreDuplicates makes this an
    // INSERT ... ON CONFLICT (message_id) DO NOTHING -- 0 rows back means
    // this message_id was already recorded (a Meta retry), 1 row means
    // this is genuinely new.
    const { data: inserted, error: insertError } = await supabase
      .from("whatsapp_webhook_events")
      .upsert({ message_id: messageId }, { onConflict: "message_id", ignoreDuplicates: true })
      .select("message_id");
    if (insertError) {
      // Genuine transient failure BEFORE any durable record exists --
      // return 500 so Meta retries, rather than silently dropping it.
      console.error("whatsapp-webhook: idempotency insert failed:", insertError.message);
      return new Response(JSON.stringify({ ok: false, error: "Server error" }), { status: 500, headers: corsHeaders });
    }
    if (!inserted || inserted.length === 0) {
      console.log(`whatsapp-webhook: duplicate delivery for message ${messageId}, skipping reprocessing`);
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    try {
      const fromPhone = String(message.from ?? "").replace(/\D/g, "");
      const text = message.text?.body ? String(message.text.body).trim() : "";

      if (fromPhone && text) {
        // Prefer the most recently-contacted shipment awaiting a reply
        // from this phone; fall back to this phone's most recent
        // shipment at all (covers a driver replying to an older request,
        // or out of the blue).
        let { data: shipment } = await supabase
          .from("shipments")
          .select("id")
          .eq("driver_phone", fromPhone)
          .eq("status", "tracking_requested")
          .order("last_contacted_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!shipment) {
          const fallback = await supabase
            .from("shipments")
            .select("id")
            .eq("driver_phone", fromPhone)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          shipment = fallback.data;
        }

        if (shipment) {
          const update: Record<string, unknown> = {
            last_driver_message: text,
            last_response_at: new Date().toISOString(),
            status: "tracking_received",
          };
          if (TRACKING_CODE_RE.test(text.replace(/\s+/g, ""))) {
            update.tracking_number = text;
          } else {
            update.carrier_eta = text;
          }
          await supabase.from("shipments").update(update).eq("id", shipment.id);
          await supabase.from("whatsapp_webhook_events").update({ shipment_id: shipment.id }).eq("message_id", messageId);
        } else {
          console.log(`whatsapp-webhook: inbound message from unrecognized phone ${fromPhone}, no matching shipment`);
        }
      }
    } catch (err) {
      // Already durably recorded above -- log and still ack. Retrying
      // wouldn't fix a bug in this matching logic, it would just repeat it.
      console.error("whatsapp-webhook: error processing inbound message:", err);
    }

    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  }

  return new Response(null, { status: 405, headers: corsHeaders });
});
