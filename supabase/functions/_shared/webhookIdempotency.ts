// Shared wrappers around the atomic webhook-idempotency RPCs (see
// supabase/migrations/20260924000000_webhook_idempotency.sql). Same
// calling convention as _shared/rateLimit.ts's claimSendSlot: explicit
// error check + throw (never silently discarded), SupabaseAdmin typed
// `any` for the same pre-existing no-generated-Database-type reason.
// deno-lint-ignore no-explicit-any
type SupabaseAdmin = any;

export type ClaimAction =
  | "proceed"
  | "duplicate_completed"
  | "duplicate_in_progress"
  | "duplicate_gave_up"
  | "gave_up";

export interface WebhookClaimResult {
  action: ClaimAction;
  attemptCount: number;
}

export async function claimWebhookEvent(
  admin: SupabaseAdmin,
  messageId: string,
  staleAfterMinutes = 5,
  maxAttempts = 5,
): Promise<WebhookClaimResult> {
  const { data, error } = await admin.rpc("claim_webhook_event", {
    p_message_id: messageId,
    p_stale_after_minutes: staleAfterMinutes,
    p_max_attempts: maxAttempts,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { action: row?.action as ClaimAction, attemptCount: row?.attempt_count ?? 0 };
}

export async function completeWebhookEvent(
  admin: SupabaseAdmin,
  messageId: string,
  shipmentId: string | null,
): Promise<void> {
  const { error } = await admin.rpc("complete_webhook_event", {
    p_message_id: messageId,
    p_shipment_id: shipmentId,
  });
  if (error) throw error;
}

export async function failWebhookEvent(
  admin: SupabaseAdmin,
  messageId: string,
  errorCategory: string,
): Promise<void> {
  try {
    const { error } = await admin.rpc("fail_webhook_event", {
      p_message_id: messageId,
      p_error_category: errorCategory,
    });
    if (error) throw error;
  } catch (e) {
    // Best-effort only -- if even this update fails, the row is left in
    // 'processing' and will simply be picked up by the stale-processing
    // recovery path on a later retry rather than stuck as 'failed'.
    console.error("failWebhookEvent: could not mark event failed:", e);
  }
}
