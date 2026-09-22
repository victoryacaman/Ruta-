import { assert, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isWithinCooldownPure, wouldClaimSucceedPure } from "../../supabase/functions/_shared/rateLimit.ts";

const NOW = new Date("2026-09-23T12:00:00Z").getTime();

Deno.test("isWithinCooldownPure: a send 10 minutes ago blocks a new send under a 30-minute window", () => {
  const tenMinAgo = new Date(NOW - 10 * 60_000).toISOString();
  assert(isWithinCooldownPure([tenMinAgo], 30, NOW));
});

Deno.test("isWithinCooldownPure: a send 40 minutes ago does not block a new send under a 30-minute window", () => {
  const fortyMinAgo = new Date(NOW - 40 * 60_000).toISOString();
  assertFalse(isWithinCooldownPure([fortyMinAgo], 30, NOW));
});

Deno.test("isWithinCooldownPure: no prior sends at all never blocks", () => {
  assertFalse(isWithinCooldownPure([], 30, NOW));
});

Deno.test("isWithinCooldownPure: a send exactly at the window boundary still counts as within cooldown", () => {
  const exactlyAtBoundary = new Date(NOW - 30 * 60_000).toISOString();
  assert(isWithinCooldownPure([exactlyAtBoundary], 30, NOW));
});

Deno.test("wouldClaimSucceedPure: under the max count, a claim succeeds", () => {
  const sends = [new Date(NOW - 5 * 60_000).toISOString()];
  assert(wouldClaimSucceedPure(sends, 60, 10, NOW));
});

Deno.test("wouldClaimSucceedPure: at the max count within the window, a claim is denied (the 11th send in an hour, cap 10)", () => {
  const sends = Array.from({ length: 10 }, (_, i) => new Date(NOW - i * 60_000).toISOString());
  assertFalse(wouldClaimSucceedPure(sends, 60, 10, NOW));
});

Deno.test("wouldClaimSucceedPure: sends outside the window don't count toward the cap", () => {
  const oldSends = Array.from({ length: 10 }, (_, i) => new Date(NOW - (120 + i) * 60_000).toISOString());
  assert(wouldClaimSucceedPure(oldSends, 60, 10, NOW));
});

Deno.test("wouldClaimSucceedPure: a maxCount of 1 models the per-shipment resend cooldown (request-tracking-update)", () => {
  const oneRecentSend = [new Date(NOW - 1 * 60_000).toISOString()];
  assertFalse(wouldClaimSucceedPure(oneRecentSend, 1440, 1, NOW));
  assert(wouldClaimSucceedPure([], 1440, 1, NOW));
});
