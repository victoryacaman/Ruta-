import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { categorizeError, decideClaimAction, type ExistingEventRow } from "../../supabase/functions/whatsapp-webhook/idempotency.ts";

const NOW = new Date("2026-09-24T12:00:00Z").getTime();
const STALE_AFTER_MINUTES = 5;
const MAX_ATTEMPTS = 5;

function row(status: ExistingEventRow["status"], attemptCount: number, minutesAgo: number): ExistingEventRow {
  return { status, attemptCount, updatedAtIso: new Date(NOW - minutesAgo * 60_000).toISOString() };
}

Deno.test("first valid delivery (no existing row) -> proceed", () => {
  assertEquals(decideClaimAction(null, STALE_AFTER_MINUTES, MAX_ATTEMPTS, NOW), "proceed");
});

Deno.test("completed duplicate -> duplicate_completed, never reprocessed", () => {
  assertEquals(decideClaimAction(row("completed", 1, 1), STALE_AFTER_MINUTES, MAX_ATTEMPTS, NOW), "duplicate_completed");
});

Deno.test("retry after failure, under max attempts -> proceed", () => {
  assertEquals(decideClaimAction(row("failed", 2, 10), STALE_AFTER_MINUTES, MAX_ATTEMPTS, NOW), "proceed");
});

Deno.test("retry after failure, at max attempts -> gave_up (stops the retry storm)", () => {
  assertEquals(decideClaimAction(row("failed", MAX_ATTEMPTS, 10), STALE_AFTER_MINUTES, MAX_ATTEMPTS, NOW), "gave_up");
});

Deno.test("a legacy_unverified row (pre-existing, unverifiable success) is treated as retryable, not completed", () => {
  assertEquals(decideClaimAction(row("legacy_unverified", 1, 60), STALE_AFTER_MINUTES, MAX_ATTEMPTS, NOW), "proceed");
});

Deno.test("processing, fresh (not stale) -> duplicate_in_progress, does not reprocess", () => {
  assertEquals(decideClaimAction(row("processing", 1, 1), STALE_AFTER_MINUTES, MAX_ATTEMPTS, NOW), "duplicate_in_progress");
});

Deno.test("stale-processing recovery: abandoned processing row past the stale window -> proceed", () => {
  assertEquals(decideClaimAction(row("processing", 1, STALE_AFTER_MINUTES + 1), STALE_AFTER_MINUTES, MAX_ATTEMPTS, NOW), "proceed");
});

Deno.test("stale-processing recovery still respects the attempt cap -> gave_up if already at max", () => {
  assertEquals(decideClaimAction(row("processing", MAX_ATTEMPTS, STALE_AFTER_MINUTES + 1), STALE_AFTER_MINUTES, MAX_ATTEMPTS, NOW), "gave_up");
});

Deno.test("processing exactly at the stale boundary is not yet stale (strictly greater-than required)", () => {
  assertEquals(decideClaimAction(row("processing", 1, STALE_AFTER_MINUTES), STALE_AFTER_MINUTES, MAX_ATTEMPTS, NOW), "duplicate_in_progress");
});

Deno.test("a duplicate arriving after gave_up -> duplicate_gave_up, never reprocessed", () => {
  assertEquals(decideClaimAction(row("gave_up", MAX_ATTEMPTS, 1), STALE_AFTER_MINUTES, MAX_ATTEMPTS, NOW), "duplicate_gave_up");
});

Deno.test("categorizeError never echoes the raw message -- only a short safe category", () => {
  assertEquals(categorizeError(new Error("connection to db timeout after 30000ms")), "timeout");
  assertEquals(categorizeError(new Error("fetch failed: network error")), "network_error");
  assertEquals(categorizeError(new Error("permission denied for table shipments (RLS policy)")), "permission_error");
  assertEquals(categorizeError(new Error("something totally unrelated")), "unknown_error");
  assertEquals(categorizeError("not even an Error instance"), "unknown_error");
});

// Documents, rather than tests, two properties that genuinely can't be
// exercised without a live Postgres instance -- flagged explicitly
// instead of silently left uncovered, matching this project's own
// established standard (e.g. the OAuth-state consumption race):
//
// 1. Concurrent duplicate deliveries of the SAME message_id can't both
//    receive "proceed" -- this is enforced by claim_webhook_event's
//    pg_advisory_xact_lock inside one Postgres transaction, which has
//    no meaningful pure-TypeScript equivalent to unit test. The
//    decideClaimAction tests above prove the single-threaded decision
//    logic is correct (fresh "processing" -> duplicate_in_progress,
//    never proceed); the actual cross-transaction serialization must be
//    verified live post-deploy (two genuinely simultaneous webhook
//    deliveries for the same message_id, confirm only one shipment
//    update happens).
// 2. "Invalid Meta signature never creates an event row" is true by
//    code-path order in whatsapp-webhook/index.ts (verifyMetaSignature
//    is checked, and returns before claimWebhookEvent is ever called,
//    if the signature fails) -- confirmed directly by reading the
//    function, and verifyMetaSignature's own correctness is already
//    exhaustively covered by crypto_test.ts. There is no separate
//    database-observable behavior to unit test here beyond what those
//    two things already cover.
