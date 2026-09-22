// Shared cooldown / rate-limit helpers backed by whatsapp_send_log.
// Used by request-tracking-update (per-shipment resend cooldown) and
// send-whatsapp-alert (generic per-user rate limit).
//
// RACE-SAFETY (2026-09-23): the original check-then-insert pattern
// (isShipmentInCooldown + logSend as two separate round-trips) had a
// TOCTOU gap -- two near-simultaneous requests could both pass the
// count check before either insert landed. claimSendSlot below replaces
// that with one atomic call (claim_whatsapp_send_slot, a Postgres
// function using an advisory transaction lock -- see the migration) so
// the check and the claim happen as one indivisible operation. The old
// functions are kept only for the still-useful read-only "how many
// recent sends" reporting; they must not be used for the actual
// allow/deny decision anymore.
// No generated Database type exists for this project, so a
// SupabaseClient instance created independently in each calling
// function's own module resolves to a structurally-incompatible type
// here (a known, pre-existing quirk -- see erp-inventory's excelAdapter
// for the same pattern with the same root cause). `any` avoids that
// friction at every call site rather than casting at each one.
// deno-lint-ignore no-explicit-any
type SupabaseAdmin = any;

export interface ClaimResult {
  allowed: boolean;
  claimId: number | null;
}

// Atomically checks the window AND claims a slot (inserts the log row)
// in one Postgres call -- see claim_whatsapp_send_slot in
// supabase/migrations/20260923000000_atomic_rate_limit.sql. Returns
// claimId so the caller can compensate (delete the row) if the actual
// send then fails, without reopening the race (the claim already
// serialized against concurrent callers before this returns).
export async function claimSendSlot(
  admin: SupabaseAdmin,
  functionName: string,
  shipmentId: string | null,
  sentBy: string | null,
  windowMinutes: number,
  maxCount = 1,
): Promise<ClaimResult> {
  // Cast to `any` here only: without a generated Database type, the
  // supabase-js v2 .rpc()/.insert() overloads collapse their argument and
  // row types to `never` for a client typed via a bare
  // `ReturnType<typeof createClient>` alias -- a known, pre-existing
  // structural quirk in this project (see erp-inventory's excelAdapter
  // for the same pattern), not a real type-safety issue with these calls.
  const { data, error } = await (admin as any).rpc("claim_whatsapp_send_slot", {
    p_function_name: functionName,
    p_shipment_id: shipmentId,
    p_sent_by: sentBy,
    p_window_minutes: windowMinutes,
    p_max_count: maxCount,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { allowed: Boolean(row?.allowed), claimId: row?.claim_id ?? null };
}

// Best-effort compensation: the external send failed after the slot was
// claimed, so give it back rather than penalizing a real failure with a
// wasted cooldown. Never throws -- a failure to release just means the
// slot stays claimed, which is the same conservative behavior as before
// this existed.
export async function releaseSendSlot(admin: SupabaseAdmin, claimId: number | null): Promise<void> {
  if (claimId == null) return;
  try {
    await admin.from("whatsapp_send_log").delete().eq("id", claimId);
  } catch (_e) {
    // best-effort only
  }
}

// Unconditional record, no gating -- for the one case where a caller has
// already been explicitly allowed to bypass the cooldown (confirmResend)
// but the send should still count toward FUTURE cooldown checks. Not a
// race target since it makes no allow/deny decision of its own.
export async function logSend(
  admin: SupabaseAdmin,
  functionName: string,
  shipmentId: string | null,
  sentBy: string | null,
): Promise<void> {
  const { error } = await (admin as any)
    .from("whatsapp_send_log")
    .insert({ function_name: functionName, shipment_id: shipmentId, sent_by: sentBy });
  if (error) throw error;
}

// Read-only reporting (NOT for the allow/deny decision -- use
// claimSendSlot for that). Still useful for surfacing "you've sent N
// times this hour" in a response body.
export async function countRecentSendsByUser(
  admin: SupabaseAdmin,
  functionName: string,
  userId: string,
  windowMinutes: number,
): Promise<number> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { count, error } = await admin
    .from("whatsapp_send_log")
    .select("id", { count: "exact", head: true })
    .eq("function_name", functionName)
    .eq("sent_by", userId)
    .gte("sent_at", since);
  if (error) throw error;
  return count ?? 0;
}

// Pure logic, extracted so it's unit-testable without a database: given
// a list of past send timestamps (ISO strings) and a window, would a
// send right now be blocked? Mirrors the SQL window logic in
// claim_whatsapp_send_slot for testing purposes -- the actual allow/deny
// decision in production always goes through the atomic RPC above, this
// is what tests/unit exercises directly.
export function isWithinCooldownPure(sentAtIso: string[], windowMinutes: number, nowMs: number = Date.now()): boolean {
  const cutoff = nowMs - windowMinutes * 60_000;
  return sentAtIso.some((iso) => new Date(iso).getTime() >= cutoff);
}

// Simulates the atomic claim's counting logic in memory, for a
// concurrency test that can't spin up a real Postgres advisory lock --
// see tests/unit/rateLimit_test.ts for how this is used to prove the
// serialized-vs-racing distinction conceptually.
export function wouldClaimSucceedPure(sentAtIso: string[], windowMinutes: number, maxCount: number, nowMs: number = Date.now()): boolean {
  const cutoff = nowMs - windowMinutes * 60_000;
  const recentCount = sentAtIso.filter((iso) => new Date(iso).getTime() >= cutoff).length;
  return recentCount < maxCount;
}
