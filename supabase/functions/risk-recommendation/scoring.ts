// Pure scoring logic, extracted out of index.ts so it's directly
// unit-testable without a live Supabase project or network access.
//
// DATA INTEGRITY (2026-09-22):
// - salesExposureLps is null (not 0) whenever unitPrice is unknown --
//   `unitsShort * null` would silently coerce to 0 in plain JS, which is
//   exactly the bug this guards against.
// - avgDailyUnitsSold === 0 is treated as "genuinely no demand, not at
//   risk", distinct from null ("we don't know"), which the previous
//   `if (!item.avgDailyUnitsSold) continue` conflated (0 is falsy too).
//
// CONSERVATIVE TRANSFERS (2026-09-22, Part B):
// - A transfer is only ever labeled "verified" when the alternate
//   warehouse's OWN reorder point is known and removing the proposed
//   units would still leave it at or above that threshold. No adapter
//   supplies that today (see erp-inventory/validation.ts), so in
//   practice every transfer right now comes back
//   "candidate_pending_source_verification" -- which is the honest
//   current state, not a bug in this module.

export interface AlternateWarehouseUnit {
  location: string;
  units: number;
  sourceReorderPoint: number | null;
  sourceAvgDailyUnitsSold: number | null;
}

export interface SkuInventoryInput {
  sku: string;
  name: string;
  onHandUnits: number | null;
  reorderPoint: number | null;
  avgDailyUnitsSold: number | null;
  unitCost: number | null;
  unitPrice: number | null;
  alternateWarehouseUnits: AlternateWarehouseUnit[];
}

export type TransferStatus = "verified" | "candidate_pending_source_verification" | "not_applicable";

export interface AtRiskSku {
  sku: string;
  name: string;
  daysOfSafetyStock: number;
  unitsShort: number;
  salesExposureLps: number | null;
  exposureUnavailableReason: string | null;
  transferUnits: number; // candidate amount -- NOT guaranteed safe unless transferStatus === "verified"
  verifiedTransferUnits: number; // amount actually confirmed safe to move without breaching a source warehouse's own reorder point
  transferCostLps: number;
  targetWarehouse: string | null;
  fullyCovered: boolean; // based on verifiedTransferUnits -- the conservative, defensible figure
  coveragePct: number; // based on verifiedTransferUnits
  candidateCoveragePct: number; // based on the unverified candidate amount, informational only
  transferStatus: TransferStatus;
  dataGaps: string[];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function computeSkuRisk(
  item: SkuInventoryInput,
  expectedDelayDays: number,
): AtRiskSku | null {
  if (item.onHandUnits == null || item.avgDailyUnitsSold == null) return null; // can't assess without both
  if (item.avgDailyUnitsSold === 0) return null; // genuinely no demand -- not at risk, not "unknown"

  const daysOfSafetyStock = item.onHandUnits / item.avgDailyUnitsSold;
  const gapDays = Math.max(0, expectedDelayDays - daysOfSafetyStock);
  if (gapDays <= 0) return null; // enough stock to cover the expected delay

  const unitsShort = Math.ceil(gapDays * item.avgDailyUnitsSold);
  const dataGaps: string[] = [];

  let salesExposureLps: number | null = null;
  let exposureUnavailableReason: string | null = null;
  if (item.unitPrice == null) {
    exposureUnavailableReason = "unitPrice is unavailable from the connected ERP -- sales exposure cannot be calculated for this SKU";
    dataGaps.push(exposureUnavailableReason);
  } else {
    salesExposureLps = unitsShort * item.unitPrice;
  }

  let candidateUnitsTotal = 0;
  let verifiedUnitsTotal = 0;
  let anySourceDataMissing = item.alternateWarehouseUnits.length === 0;
  for (const alt of item.alternateWarehouseUnits) {
    candidateUnitsTotal += alt.units;
    if (alt.sourceReorderPoint != null) {
      const safeToMove = Math.max(0, alt.units - alt.sourceReorderPoint);
      verifiedUnitsTotal += safeToMove;
      if (safeToMove < alt.units) {
        dataGaps.push(
          `${alt.location}: only ${safeToMove} of ${alt.units} units confirmed movable without breaching that warehouse's own reorder point`,
        );
      }
    } else {
      anySourceDataMissing = true;
    }
  }
  if (anySourceDataMissing) {
    dataGaps.push(
      "source-warehouse demand/reorder-point data is not available from the connected ERP adapter -- this transfer is a candidate, not yet verified safe for the source warehouse",
    );
  }

  const transferUnits = Math.min(unitsShort, candidateUnitsTotal);
  const verifiedTransferUnits = Math.min(unitsShort, verifiedUnitsTotal);
  const transferStatus: TransferStatus = transferUnits === 0
    ? "not_applicable"
    : (!anySourceDataMissing && verifiedTransferUnits >= transferUnits ? "verified" : "candidate_pending_source_verification");

  const targetWarehouse = item.alternateWarehouseUnits[0]?.location ?? null;
  const coverageDenominator = item.onHandUnits + unitsShort;
  const coveragePct = coverageDenominator > 0
    ? round1(((item.onHandUnits + verifiedTransferUnits) / coverageDenominator) * 100)
    : 100;
  const candidateCoveragePct = coverageDenominator > 0
    ? round1(((item.onHandUnits + transferUnits) / coverageDenominator) * 100)
    : 100;

  return {
    sku: item.sku,
    name: item.name,
    daysOfSafetyStock: round1(daysOfSafetyStock),
    unitsShort,
    salesExposureLps,
    exposureUnavailableReason,
    transferUnits,
    verifiedTransferUnits,
    transferCostLps: transferUnits * 0, // placeholder, set by caller once transferCostPerUnitLps is known -- see computeAtRiskSkus
    targetWarehouse,
    fullyCovered: verifiedTransferUnits >= unitsShort,
    coveragePct,
    candidateCoveragePct,
    transferStatus,
    dataGaps,
  };
}

export interface RecommendationAggregate {
  applicable: boolean;
  atRiskSkus: AtRiskSku[];
  totalExposureLps: number | null;
  exposureIncomplete: boolean;
  totalTransferCostLps: number;
  totalTransferUnits: number;
  totalVerifiedTransferUnits: number;
  anyUnverifiedTransfers: boolean;
  roiMultiple: number | null;
  roiUnavailableReason: string | null;
  avgCoveragePct: number;
  topWarehouse: { location: string; units: number } | null;
}

export function computeAtRiskSkus(
  items: SkuInventoryInput[],
  expectedDelayDays: number,
  transferCostPerUnitLps: number,
): RecommendationAggregate {
  const atRiskSkus: AtRiskSku[] = [];
  if (expectedDelayDays > 0) {
    for (const item of items) {
      const risk = computeSkuRisk(item, expectedDelayDays);
      if (!risk) continue;
      risk.transferCostLps = risk.transferUnits * transferCostPerUnitLps;
      atRiskSkus.push(risk);
    }
  }
  atRiskSkus.sort((a, b) => a.daysOfSafetyStock - b.daysOfSafetyStock);

  if (!atRiskSkus.length) {
    return {
      applicable: false, atRiskSkus: [],
      totalExposureLps: null, exposureIncomplete: false,
      totalTransferCostLps: 0, totalTransferUnits: 0, totalVerifiedTransferUnits: 0,
      anyUnverifiedTransfers: false, roiMultiple: null, roiUnavailableReason: null,
      avgCoveragePct: 100, topWarehouse: null,
    };
  }

  const withExposure = atRiskSkus.filter((s) => s.salesExposureLps != null);
  const exposureIncomplete = withExposure.length < atRiskSkus.length;
  const totalExposureLps = withExposure.length
    ? withExposure.reduce((s, x) => s + (x.salesExposureLps ?? 0), 0)
    : null;

  const totalTransferCostLps = atRiskSkus.reduce((s, x) => s + x.transferCostLps, 0);
  const totalTransferUnits = atRiskSkus.reduce((s, x) => s + x.transferUnits, 0);
  const totalVerifiedTransferUnits = atRiskSkus.reduce((s, x) => s + x.verifiedTransferUnits, 0);
  const anyUnverifiedTransfers = atRiskSkus.some((s) => s.transferStatus === "candidate_pending_source_verification");

  let roiMultiple: number | null = null;
  let roiUnavailableReason: string | null = null;
  if (exposureIncomplete || totalExposureLps == null) {
    roiUnavailableReason = "Sales exposure is unknown for at least one at-risk SKU (missing unit price) -- a total ROI multiple would be misleading.";
  } else if (totalTransferCostLps <= 0) {
    roiUnavailableReason = "No transfer cost to compare exposure against.";
  } else {
    roiMultiple = round1(totalExposureLps / totalTransferCostLps);
  }

  const avgCoveragePct = totalExposureLps
    ? round1((atRiskSkus.reduce((s, x) => s + x.coveragePct * (x.salesExposureLps ?? 0), 0) / totalExposureLps))
    : round1(atRiskSkus.reduce((s, x) => s + x.coveragePct, 0) / atRiskSkus.length);

  const warehouseTotals: Record<string, number> = {};
  for (const s of atRiskSkus) {
    if (s.targetWarehouse) warehouseTotals[s.targetWarehouse] = (warehouseTotals[s.targetWarehouse] ?? 0) + s.transferUnits;
  }
  const topWarehouseEntry = Object.entries(warehouseTotals).sort((a, b) => b[1] - a[1])[0];

  return {
    applicable: true,
    atRiskSkus,
    totalExposureLps, exposureIncomplete,
    totalTransferCostLps, totalTransferUnits, totalVerifiedTransferUnits,
    anyUnverifiedTransfers,
    roiMultiple, roiUnavailableReason,
    avgCoveragePct,
    topWarehouse: topWarehouseEntry ? { location: topWarehouseEntry[0], units: topWarehouseEntry[1] } : null,
  };
}
