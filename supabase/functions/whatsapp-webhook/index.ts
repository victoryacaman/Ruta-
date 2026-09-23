import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { verifyMetaSignature } from "../_shared/crypto.ts";
import { claimWebhookEvent, completeWebhookEvent, failWebhookEvent } from "../_shared/webhookIdempotency.ts";
import { categorizeError } from "./idempotency.ts";

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
// unverifiable. Rejected before any body parsing or DB write, so an
// invalid signature can never reach the idempotency claim below.
//
// IDEMPOTENCY, FIXED FOR REAL (2026-09-24): the original version of this
// function inserted a bare message_id row BEFORE doing any shipment
// work, then treated any later delivery of the same id as "already
// handled" -- with no column distinguishing "recorded" from "recorded
// AND successfully processed." A real failure in the shipment update
// (its own {error} was never checked) was silently discarded, and the
// function still acked 200 regardless -- so Meta was never told to
// retry, and if it somehow had, the existing row would have caused the
// retry to be skipped before the update ever ran again. See
// supabase/migrations/20260924000000_webhook_idempotency.sql and
// _shared/webhookIdempotency.ts: claimWebhookEvent now atomically
// (pg_advisory_xact_lock, same idiom as claim_whatsapp_send_slot)
// decides one of proceed / duplicate_completed / duplicate_in_progress /
// duplicate_gave_up / gave_up. Only 'proceed' ever runs the shipment
// logic below, and only a genuinely successful outcome calls
// completeWebhookEvent -- a thrown error calls failWebhookEvent and
// returns a retryable non-2xx instead of acking 200.

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

// Looks up and updates the shipment for an inbound message. Returns the
// matched shipment's id (or null if no shipment matched -- a legitimate,
// successful "nothing to do" outcome, not a failure). Throws on any real
// database error instead of the previous silent-discard behavior, so a
// genuine failure actually reaches the caller's catch block.
async function processInboundMessage(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  message: { from?: unknown; text?: { body?: unknown } },
): Promise<string | null> {
  const fromPhone = String(message.from ?? "").replace(/\D/g, "");
  const text = message.text?.body ? String(message.text.body).trim() : "";
  if (!fromPhone || !text) return null;

  // Prefer the most recently-contacted shipment awaiting a reply from
  // this phone; fall back to this phone's most recent shipment at all
  // (covers a driver replying to an older request, or out of the blue).
  const primary = await supabase
    .from("shipments")
    .select("id")
    .eq("driver_phone", fromPhone)
    .eq("status", "tracking_requested")
    .order("last_contacted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (primary.error) throw primary.error;
  let shipment = primary.data;

  if (!shipment) {
    const fallback = await supabase
      .from("shipments")
      .select("id")
      .eq("driver_phone", fromPhone)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fallback.error) throw fallback.error;
    shipment = fallback.data;
  }

  if (!shipment) {
    console.log(`whatsapp-webhook: inbound message from unrecognized phone ${fromPhone}, no matching shipment`);
    return null;
  }

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
  const { error: updateError } = await supabase.from("shipments").update(update).eq("id", shipment.id);
  if (updateError) throw updateError;

  return shipment.id as string;
}

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

    let claim;
    try {
      claim = await claimWebhookEvent(supabase, messageId);
    } catch (err) {
      // Genuine transient failure BEFORE any durable record exists --
      // return 500 so Meta retries, rather than silently dropping it.
      console.error("whatsapp-webhook: idempotency claim failed:", err);
      return new Response(JSON.stringify({ ok: false, error: "Server error" }), { status: 500, headers: corsHeaders });
    }

    if (claim.action === "duplicate_completed") {
      console.log(`whatsapp-webhook: duplicate delivery for already-completed message ${messageId}, skipping reprocessing`);
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }
    if (claim.action === "duplicate_gave_up") {
      console.log(`whatsapp-webhook: duplicate delivery for message ${messageId}, already gave up after ${claim.attemptCount} attempts`);
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }
    if (claim.action === "duplicate_in_progress") {
      // Genuinely not finished yet from this request's point of view --
      // ask Meta to retry later rather than guessing at an outcome.
      console.log(`whatsapp-webhook: message ${messageId} is already being processed, asking Meta to retry later`);
      return new Response(JSON.stringify({ ok: false, error: "Still processing, retry later" }), { status: 409, headers: corsHeaders });
    }
    if (claim.action === "gave_up") {
      console.error(`whatsapp-webhook: giving up on message ${messageId} after ${claim.attemptCount} attempts -- acking to stop the retry storm, needs manual investigation`);
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    // claim.action === "proceed"
    try {
      const shipmentId = await processInboundMessage(supabase, message);
      await completeWebhookEvent(supabase, messageId, shipmentId);
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    } catch (err) {
      console.error("whatsapp-webhook: error processing inbound message:", err);
      await failWebhookEvent(supabase, messageId, categorizeError(err));
      // The update genuinely did not complete -- never ack success for
      // this. Retryable, so Meta redelivers and the next claim recovers
      // this exact 'failed' row.
      return new Response(JSON.stringify({ ok: false, error: "Processing failed" }), { status: 500, headers: corsHeaders });
    }
  }

  return new Response(null, { status: 405, headers: corsHeaders });
});
