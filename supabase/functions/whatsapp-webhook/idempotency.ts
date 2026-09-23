// Pure mirror of claim_webhook_event's branching (see
// supabase/migrations/20260924000000_webhook_idempotency.sql), extracted
// so the decision logic is unit-testable without a live database --
// same idiom as _shared/rateLimit.ts's wouldClaimSucceedPure mirroring
// claim_whatsapp_send_slot. Production always goes through the real
// RPC; this file is never imported by index.ts's actual request path,
// only by tests. Keep the two in sync by hand if either changes.

export type EventStatus = "processing" | "completed" | "failed" | "gave_up" | "legacy_unverified";

export type ClaimAction =
  | "proceed" // new message, or a retryable/stale row being reclaimed -- go process it
  | "duplicate_completed" // already fully processed -- ack, don't reprocess
  | "duplicate_in_progress" // another (or the same, moments ago) request is still working on it
  | "duplicate_gave_up" // already exceeded max_attempts and stopped retrying -- ack, don't reprocess
  | "gave_up"; // THIS call is the one that pushed attempt_count over the limit

export interface ExistingEventRow {
  status: EventStatus;
  attemptCount: number;
  updatedAtIso: string;
}

export function decideClaimAction(
  existing: ExistingEventRow | null,
  staleAfterMinutes: number,
  maxAttempts: number,
  nowMs: number = Date.now(),
): ClaimAction {
  if (!existing) return "proceed";
  if (existing.status === "completed") return "duplicate_completed";
  if (existing.status === "gave_up") return "duplicate_gave_up";

  const staleMs = staleAfterMinutes * 60_000;
  const isStale = nowMs - new Date(existing.updatedAtIso).getTime() > staleMs;
  if (existing.status === "processing" && !isStale) return "duplicate_in_progress";

  // Retryable from here: status is 'failed' or 'legacy_unverified', or a
  // 'processing' row old enough to be considered abandoned (crash/
  // timeout/deploy-restart between claiming and finishing).
  if (existing.attemptCount >= maxAttempts) return "gave_up";
  return "proceed";
}

// Maps an exception to a short, safe category -- never the raw message,
// stack trace, or any WhatsApp content, per this table's own column
// comment (last_error_category).
export function categorizeError(err: unknown): string {
  if (err instanceof Error) {
    if (/timeout/i.test(err.name) || /timeout/i.test(err.message)) return "timeout";
    if (/network|fetch/i.test(err.message)) return "network_error";
    if (/permission|rls|policy/i.test(err.message)) return "permission_error";
  }
  return "unknown_error";
}
