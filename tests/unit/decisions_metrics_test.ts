import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeDecisionMetrics, type EventSummary, type SnapshotSummary } from "../../supabase/functions/decisions-list/metrics.ts";

Deno.test("approve then undo reverts the snapshot to 'no action', not 'approved'", () => {
  const snapshots: SnapshotSummary[] = [{ id: "s1", recommendationApplicable: true }];
  const events: EventSummary[] = [
    { snapshotId: "s1", eventType: "approved", createdAt: "2026-09-22T10:00:00Z" },
    { snapshotId: "s1", eventType: "undone", createdAt: "2026-09-22T10:05:00Z" },
  ];
  const m = computeDecisionMetrics(snapshots, events);
  assertEquals(m.approved, 0);
  assertEquals(m.noAction, 1);
  assertEquals(m.actedUpon, 0);
  assertEquals(m.undoneEventCount, 1);
});

Deno.test("approval rate excludes 'no action' snapshots from its denominator", () => {
  const snapshots: SnapshotSummary[] = [
    { id: "s1", recommendationApplicable: true }, // approved
    { id: "s2", recommendationApplicable: true }, // dismissed
    { id: "s3", recommendationApplicable: true }, // no action -- must NOT dilute the rate
    { id: "s4", recommendationApplicable: true }, // no action
  ];
  const events: EventSummary[] = [
    { snapshotId: "s1", eventType: "approved", createdAt: "2026-09-22T10:00:00Z" },
    { snapshotId: "s2", eventType: "dismissed", createdAt: "2026-09-22T10:00:00Z" },
  ];
  const m = computeDecisionMetrics(snapshots, events);
  // 1 approved out of (1 approved + 1 dismissed) = 50%, NOT 1 out of 4 (25%)
  assertEquals(m.approvalRatePct, 50);
});

Deno.test("decision coverage divides acted-upon by distinct applicable recommendations shown", () => {
  const snapshots: SnapshotSummary[] = [
    { id: "s1", recommendationApplicable: true },
    { id: "s2", recommendationApplicable: true },
    { id: "s3", recommendationApplicable: true },
    { id: "s4", recommendationApplicable: false }, // not applicable -- excluded from the denominator entirely
  ];
  const events: EventSummary[] = [
    { snapshotId: "s1", eventType: "approved", createdAt: "2026-09-22T10:00:00Z" },
  ];
  const m = computeDecisionMetrics(snapshots, events);
  assertEquals(m.distinctApplicableRecommendations, 3);
  assertEquals(m.decisionCoveragePct, Math.round((1 / 3) * 1000) / 10);
});

Deno.test("no applicable recommendations at all -> coverage and approval rate are null, not 0", () => {
  const snapshots: SnapshotSummary[] = [{ id: "s1", recommendationApplicable: false }];
  const m = computeDecisionMetrics(snapshots, []);
  assertEquals(m.decisionCoveragePct, null);
  assertEquals(m.approvalRatePct, null);
});

Deno.test("only the LATEST event per snapshot counts (matches the dashboard's own live behavior)", () => {
  const snapshots: SnapshotSummary[] = [{ id: "s1", recommendationApplicable: true }];
  const events: EventSummary[] = [
    { snapshotId: "s1", eventType: "dismissed", createdAt: "2026-09-22T10:00:00Z" },
    { snapshotId: "s1", eventType: "approved", createdAt: "2026-09-22T10:05:00Z" },
  ];
  const m = computeDecisionMetrics(snapshots, events);
  assertEquals(m.approved, 1);
  assertEquals(m.dismissed, 0);
});

// Demo/development exclusion itself is a SQL-level filter in
// decisions-list/index.ts (environment = 'pilot' by default), not this
// pure module -- this test documents the CONTRACT: computeDecisionMetrics
// only ever sees whatever rows the caller already filtered, so passing it
// a demo-only snapshot list here demonstrates that such rows would be
// counted if (and only if) the caller chose to include them (?scope=all).
// The default-exclusion behavior itself needs a live deploy to verify
// end-to-end against a real risk_snapshots table -- see
// tests/integration/README.md.
Deno.test("this module has no awareness of environment -- filtering is the caller's job", () => {
  const allDemoSnapshots: SnapshotSummary[] = [
    { id: "demo1", recommendationApplicable: true },
  ];
  const m = computeDecisionMetrics(allDemoSnapshots, []);
  assertEquals(m.distinctApplicableRecommendations, 1); // counts whatever it's given -- proves the filter must happen before this call
});
