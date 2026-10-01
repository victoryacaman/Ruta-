// Deterministic fingerprint over the MATERIAL inputs to a recommendation
// -- not the full response (timestamps, raw weather-day arrays, etc.
// would make every computation look unique even when nothing that
// actually drives the recommendation changed). Two computations with the
// same fingerprint are, for decision-history purposes, the same
// recommendation shown again -- see index.ts's dedup logic.

export interface FingerprintSkuInput {
  sku: string;
  unitsShort: number;
  transferUnits: number;
  salesExposureLps?: number | null;
}

export interface FingerprintInput {
  locationName: string;
  severity: string;
  expectedDelayDays: number | null;
  erpProvider: string;
  environment?: string;
  computationSource?: string;
  testRunId?: string | null;
  currencyCode?: string | null;
  financialsAvailable?: boolean;
  inventoryScope?: string | null;
  transferCostPerUnitLps?: number;
  dataIsStale?: boolean;
  atRiskSkus: FingerprintSkuInput[];
  assessment?: {
    status: string;
    reasons: string[];
    assessedSkuCount: number;
    rejectedSkuCount: number;
    unassessedSkus: { sku: string; missingFields: string[] }[];
  };
}

export async function computeSignalFingerprint(input: FingerprintInput): Promise<string> {
  const canonical = JSON.stringify({
    locationName: input.locationName,
    severity: input.severity,
    expectedDelayDays: input.expectedDelayDays,
    erpProvider: input.erpProvider,
    environment: input.environment,
    computationSource: input.computationSource,
    testRunId: input.testRunId,
    currencyCode: input.currencyCode,
    financialsAvailable: input.financialsAvailable,
    inventoryScope: input.inventoryScope,
    transferCostPerUnitLps: input.transferCostPerUnitLps,
    dataIsStale: input.dataIsStale,
    assessment: input.assessment ? {
      status: input.assessment.status,
      reasons: [...input.assessment.reasons].sort(),
      assessedSkuCount: input.assessment.assessedSkuCount,
      rejectedSkuCount: input.assessment.rejectedSkuCount,
      unassessedSkus: input.assessment.unassessedSkus.map((s) => ({
        sku: s.sku, missingFields: [...s.missingFields].sort(),
      })).sort((a, b) => a.sku.localeCompare(b.sku)),
    } : undefined,
    atRiskSkus: [...input.atRiskSkus]
      .map((s) => ({ sku: s.sku, unitsShort: s.unitsShort, transferUnits: s.transferUnits, salesExposureLps: s.salesExposureLps }))
      .sort((a, b) => a.sku.localeCompare(b.sku)),
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
