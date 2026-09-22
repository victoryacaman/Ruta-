// Pure metrics logic, extracted so the denominators below are directly
// unit-testable. DATA INTEGRITY (2026-09-22, Part C): the old
// approvalRatePct here was already correctly excluding "no action"
// snapshots from its denominator -- the actual bug this fixes is that
// EVERY snapshot (development, demo, or a page reload with nothing new
// to show) fed into "how many recommendations were shown" with equal
// weight. Filtering by environment/computation_source is the caller's
// job (a SQL WHERE clause in index.ts); this module assumes it already
// received the right rows.

export interface SnapshotSummary {
  id: string;
  recommendationApplicable: boolean;
}

export interface EventSummary {
  snapshotId: string;
  eventType: "approved" | "dismissed" | "undone";
  createdAt: string;
}

export interface DecisionMetrics {
  distinctApplicableRecommendations: number;
  actedUpon: number;
  approved: number;
  dismissed: number;
  noAction: number;
  undoneEventCount: number;
  // acted-upon applicable recommendations / recommendations shown --
  // "shown" here means the distinct recommendation situations that were
  // ever computed as applicable, not raw page-load repeats (a repeat
  // view of the same still-undecided recommendation isn't a second
  // decision opportunity). See BUILD_LOG.md for this interpretive call.
  decisionCoveragePct: number | null;
  // approvals / (approvals + dismissals) -- deliberately excludes
  // "no action" and "not applicable" snapshots from the denominator, so
  // a pile of ignored recommendations doesn't silently dilute the rate.
  approvalRatePct: number | null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function computeDecisionMetrics(snapshots: SnapshotSummary[], events: EventSummary[]): DecisionMetrics {
  const latestEventBySnapshot = new Map<string, EventSummary>();
  for (const ev of events) {
    const existing = latestEventBySnapshot.get(ev.snapshotId);
    if (!existing || ev.createdAt > existing.createdAt) latestEventBySnapshot.set(ev.snapshotId, ev);
  }

  const applicable = snapshots.filter((s) => s.recommendationApplicable);
  let approved = 0, dismissed = 0, noAction = 0;
  for (const s of applicable) {
    const latest = latestEventBySnapshot.get(s.id);
    if (latest?.eventType === "approved") approved++;
    else if (latest?.eventType === "dismissed") dismissed++;
    else noAction++;
  }
  const actedUpon = approved + dismissed;
  const undoneEventCount = events.filter((e) => e.eventType === "undone").length;

  return {
    distinctApplicableRecommendations: applicable.length,
    actedUpon, approved, dismissed, noAction, undoneEventCount,
    decisionCoveragePct: applicable.length > 0 ? round1((actedUpon / applicable.length) * 100) : null,
    approvalRatePct: actedUpon > 0 ? round1((approved / actedUpon) * 100) : null,
  };
}
