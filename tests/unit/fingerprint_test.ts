import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeSignalFingerprint } from "../../supabase/functions/risk-recommendation/fingerprint.ts";

const BASE = {
  locationName: "Puerto Cortés",
  severity: "medium",
  expectedDelayDays: 5,
  erpProvider: "excel",
  atRiskSkus: [
    { sku: "B-1", unitsShort: 10, transferUnits: 5 },
    { sku: "A-1", unitsShort: 3, transferUnits: 3 },
  ],
};

Deno.test("identical material inputs produce the identical fingerprint (repeated computation is deduplicatable)", async () => {
  const a = await computeSignalFingerprint(BASE);
  const b = await computeSignalFingerprint(structuredClone(BASE));
  assertEquals(a, b);
});

Deno.test("SKU order doesn't change the fingerprint (canonical sort)", async () => {
  const reordered = { ...BASE, atRiskSkus: [...BASE.atRiskSkus].reverse() };
  const a = await computeSignalFingerprint(BASE);
  const b = await computeSignalFingerprint(reordered);
  assertEquals(a, b);
});

Deno.test("a real change in severity changes the fingerprint", async () => {
  const a = await computeSignalFingerprint(BASE);
  const b = await computeSignalFingerprint({ ...BASE, severity: "high" });
  assertNotEquals(a, b);
});

Deno.test("a real change in a SKU's shortfall changes the fingerprint", async () => {
  const a = await computeSignalFingerprint(BASE);
  const changed = { ...BASE, atRiskSkus: [{ sku: "A-1", unitsShort: 999, transferUnits: 3 }, BASE.atRiskSkus[0]] };
  const b = await computeSignalFingerprint(changed);
  assertNotEquals(a, b);
});
