import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeAtRiskSkus, computeSkuRisk, type SkuInventoryInput } from "../../supabase/functions/risk-recommendation/scoring.ts";

function baseItem(overrides: Partial<SkuInventoryInput> = {}): SkuInventoryInput {
  return {
    sku: "SKU-1", name: "Test SKU",
    onHandUnits: 10, reorderPoint: 20, avgDailyUnitsSold: 5,
    unitCost: 100, unitPrice: 200,
    alternateWarehouseUnits: [],
    ...overrides,
  };
}

Deno.test("missing avgDailyUnitsSold -> SKU skipped (unknown, not zero)", () => {
  const risk = computeSkuRisk(baseItem({ avgDailyUnitsSold: null }), 5);
  assertEquals(risk, null);
});

Deno.test("genuine zero avgDailyUnitsSold -> not at risk (infinite runway), distinct from unknown", () => {
  const risk = computeSkuRisk(baseItem({ avgDailyUnitsSold: 0, onHandUnits: 0 }), 5);
  assertEquals(risk, null); // no demand at all -- correctly not flagged, and doesn't throw/NaN
});

Deno.test("missing unitPrice -> at-risk SKU still reported, but exposure is null with a reason, never L0", () => {
  const risk = computeSkuRisk(baseItem({ unitPrice: null }), 5)!;
  assertEquals(risk.salesExposureLps, null);
  assertEquals(risk.exposureUnavailableReason !== null, true);
  assertEquals(risk.unitsShort > 0, true); // the shortfall itself is still known and reported
});

Deno.test("genuine zero unitPrice -> exposure correctly computed as 0, not treated as unavailable", () => {
  const risk = computeSkuRisk(baseItem({ unitPrice: 0 }), 5)!;
  assertEquals(risk.salesExposureLps, 0);
  assertEquals(risk.exposureUnavailableReason, null);
});

Deno.test("missing alternate-warehouse demand data -> transfer is a candidate, not verified", () => {
  const risk = computeSkuRisk(baseItem({
    alternateWarehouseUnits: [{ location: "Tegucigalpa", units: 100, sourceReorderPoint: null, sourceAvgDailyUnitsSold: null }],
  }), 5)!;
  assertEquals(risk.transferStatus, "candidate_pending_source_verification");
  assertEquals(risk.verifiedTransferUnits, 0);
  assertEquals(risk.transferUnits > 0, true); // the candidate amount is still surfaced, just not presented as verified
  assertEquals(risk.dataGaps.length > 0, true);
});

Deno.test("no alternate warehouse at all -> transfer not applicable, not a false candidate", () => {
  const risk = computeSkuRisk(baseItem({ alternateWarehouseUnits: [] }), 5)!;
  assertEquals(risk.transferStatus, "not_applicable");
  assertEquals(risk.transferUnits, 0);
});

Deno.test("safe transfer: source reorder point known, enough surplus above it -> fully verified", () => {
  // Source warehouse has 100 units, needs to keep at least 20 (its own
  // reorder point) -- moving the needed 15 leaves 85, well above 20.
  const risk = computeSkuRisk(baseItem({
    onHandUnits: 5, avgDailyUnitsSold: 4, // gap -> unitsShort should be well under 80
    alternateWarehouseUnits: [{ location: "Tegucigalpa", units: 100, sourceReorderPoint: 20, sourceAvgDailyUnitsSold: 2 }],
  }), 5)!;
  assertEquals(risk.transferStatus, "verified");
  assertEquals(risk.verifiedTransferUnits, risk.transferUnits);
  assertEquals(risk.fullyCovered, true);
});

Deno.test("unsafe transfer: source reorder point known, NOT enough surplus -> capped, not fully verified", () => {
  // Source has only 25 units and must keep 20 -- only 5 are ever safe to
  // move, regardless of how many units are "available" on paper.
  const risk = computeSkuRisk(baseItem({
    onHandUnits: 0, avgDailyUnitsSold: 10, // large shortfall, more than 5 units short
    alternateWarehouseUnits: [{ location: "Tegucigalpa", units: 25, sourceReorderPoint: 20, sourceAvgDailyUnitsSold: 1 }],
  }), 5)!;
  assertEquals(risk.verifiedTransferUnits, 5); // capped at units - sourceReorderPoint
  assertEquals(risk.verifiedTransferUnits < risk.transferUnits, true);
  assertEquals(risk.transferStatus, "candidate_pending_source_verification"); // known-but-insufficient source data still isn't "verified"
  assertEquals(risk.dataGaps.some((g) => g.includes("only 5 of 25")), true);
});

Deno.test("aggregate: ROI is null (not misleading) when any at-risk SKU's exposure is unknown", () => {
  const items = [
    baseItem({ sku: "A", unitPrice: 200 }),
    baseItem({ sku: "B", unitPrice: null }),
  ];
  const agg = computeAtRiskSkus(items, 5, 45);
  assertEquals(agg.exposureIncomplete, true);
  assertEquals(agg.roiMultiple, null);
  assertEquals(agg.roiUnavailableReason !== null, true);
});

Deno.test("aggregate: ROI computed normally when every at-risk SKU has known exposure", () => {
  const items = [
    baseItem({ sku: "A", unitPrice: 200, alternateWarehouseUnits: [{ location: "X", units: 50, sourceReorderPoint: null, sourceAvgDailyUnitsSold: null }] }),
  ];
  const agg = computeAtRiskSkus(items, 5, 45);
  assertEquals(agg.exposureIncomplete, false);
  assertEquals(typeof agg.roiMultiple, "number");
});

Deno.test("aggregate: exposure total is null, not 0, when NO at-risk SKU has known price", () => {
  const items = [baseItem({ unitPrice: null })];
  const agg = computeAtRiskSkus(items, 5, 45);
  assertEquals(agg.applicable, true);
  assertEquals(agg.totalExposureLps, null);
});

Deno.test("no at-risk SKUs -> recommendation not applicable, not fabricated", () => {
  const items = [baseItem({ onHandUnits: 1000, avgDailyUnitsSold: 1 })]; // huge safety stock
  const agg = computeAtRiskSkus(items, 5, 45);
  assertEquals(agg.applicable, false);
  assertEquals(agg.atRiskSkus.length, 0);
});
