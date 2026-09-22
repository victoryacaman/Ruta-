import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateAndNormalizeAll, validateAndNormalizeItem } from "../../supabase/functions/erp-inventory/validation.ts";

Deno.test("missing unitPrice becomes null, not 0", () => {
  const { item } = validateAndNormalizeItem({ sku: "A1", onHandUnits: 10, avgDailyUnitsSold: 1 });
  assertEquals(item?.unitPrice, null);
});

Deno.test("genuine zero price is preserved as 0, distinct from unknown", () => {
  const known = validateAndNormalizeItem({ sku: "A1", unitPrice: 0 }).item;
  const unknown = validateAndNormalizeItem({ sku: "A2" }).item;
  assertEquals(known?.unitPrice, 0);
  assertEquals(unknown?.unitPrice, null);
  assertNotEquals(known?.unitPrice, unknown?.unitPrice); // both are falsy in JS but must not be treated the same
});

Deno.test("missing sales velocity becomes null, not 0", () => {
  const { item } = validateAndNormalizeItem({ sku: "A1", onHandUnits: 10 });
  assertEquals(item?.avgDailyUnitsSold, null);
});

Deno.test("genuine zero sales velocity (never sells) is preserved as 0", () => {
  const { item } = validateAndNormalizeItem({ sku: "A1", onHandUnits: 10, avgDailyUnitsSold: 0 });
  assertEquals(item?.avgDailyUnitsSold, 0);
});

Deno.test("negative on-hand units is flagged and nulled, not trusted", () => {
  const { item, issues } = validateAndNormalizeItem({ sku: "A1", onHandUnits: -5 });
  assertEquals(item?.onHandUnits, null);
  assertEquals(issues.some((i) => i.includes("negative")), true);
});

Deno.test("negative unitCost is flagged and nulled", () => {
  const { item, issues } = validateAndNormalizeItem({ sku: "A1", unitCost: -12.5 });
  assertEquals(item?.unitCost, null);
  assertEquals(issues.length > 0, true);
});

Deno.test("non-finite values (NaN/Infinity) never reach the output", () => {
  const { item, issues } = validateAndNormalizeItem({ sku: "A1", unitPrice: "not-a-number" as any });
  assertEquals(item?.unitPrice, null);
  assertEquals(issues.length > 0, true);
});

Deno.test("malformed SKU is rejected outright (not just flagged)", () => {
  const { item, issues } = validateAndNormalizeItem({ sku: "   " });
  assertEquals(item, null);
  assertEquals(issues.length > 0, true);
});

Deno.test("empty SKU is rejected", () => {
  const { item } = validateAndNormalizeItem({ sku: "" });
  assertEquals(item, null);
});

Deno.test("alternate-warehouse demand fields default to null, never fabricated", () => {
  const { item } = validateAndNormalizeItem({
    sku: "A1",
    alternateWarehouseUnits: [{ location: "Tegucigalpa", units: 50 }],
  });
  const alt = item!.alternateWarehouseUnits[0];
  assertEquals(alt.units, 50);
  assertEquals(alt.sourceReorderPoint, null);
  assertEquals(alt.sourceAvgDailyUnitsSold, null);
});

Deno.test("a real alternate-warehouse reorder point is preserved when present", () => {
  const { item } = validateAndNormalizeItem({
    sku: "A1",
    alternateWarehouseUnits: [{ location: "Tegucigalpa", units: 50, sourceReorderPoint: 20, sourceAvgDailyUnitsSold: 3 }],
  });
  const alt = item!.alternateWarehouseUnits[0];
  assertEquals(alt.sourceReorderPoint, 20);
  assertEquals(alt.sourceAvgDailyUnitsSold, 3);
});

Deno.test("validateAndNormalizeAll rejects malformed items but keeps valid ones, reporting the count", () => {
  const { items, rejectedCount } = validateAndNormalizeAll([
    { sku: "GOOD-1", onHandUnits: 5 },
    { sku: "" },
    { sku: "GOOD-2", onHandUnits: 8 },
  ]);
  assertEquals(items.length, 2);
  assertEquals(rejectedCount, 1);
});
