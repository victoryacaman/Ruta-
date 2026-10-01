import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeFreshness } from "../../supabase/functions/_shared/freshness.ts";

const NOW = new Date("2026-10-01T00:00:00Z");

Deno.test("no timestamp at all -> unknown, never guessed stale", () => {
  const r = computeFreshness(null, 3, NOW);
  assertEquals(r.lastModifiedAtIso, null);
  assertEquals(r.staleDays, null);
  assertEquals(r.isStale, false);
});

Deno.test("unparseable timestamp -> treated the same as unknown, not stale", () => {
  const r = computeFreshness("not-a-date", 3, NOW);
  assertEquals(r.lastModifiedAtIso, null);
  assertEquals(r.isStale, false);
});

Deno.test("modified today -> not stale, staleDays near 0", () => {
  const r = computeFreshness("2026-10-01T00:00:00Z", 3, NOW);
  assertEquals(r.isStale, false);
  assertEquals(r.staleDays, 0);
});

Deno.test("exactly at the threshold -> not yet stale (strictly greater-than required)", () => {
  const r = computeFreshness("2026-09-28T00:00:00Z", 3, NOW);
  assertEquals(r.staleDays, 3);
  assertEquals(r.isStale, false);
});

Deno.test("just past the threshold -> stale", () => {
  const r = computeFreshness("2026-09-27T23:00:00Z", 3, NOW);
  assertEquals(r.isStale, true);
});

Deno.test("a future last-modified timestamp (clock skew) never produces a negative staleDays", () => {
  const r = computeFreshness("2026-10-02T00:00:00Z", 3, NOW);
  assertEquals(r.staleDays, 0);
  assertEquals(r.isStale, false);
});

Deno.test("a different staleAfterDays threshold is respected", () => {
  const tenDaysAgo = "2026-09-21T00:00:00Z";
  assertEquals(computeFreshness(tenDaysAgo, 3, NOW).isStale, true);
  assertEquals(computeFreshness(tenDaysAgo, 14, NOW).isStale, false);
});
