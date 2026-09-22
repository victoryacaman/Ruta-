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
}

export interface FingerprintInput {
  locationName: string;
  severity: string;
  expectedDelayDays: number;
  erpProvider: string;
  atRiskSkus: FingerprintSkuInput[];
}

export async function computeSignalFingerprint(input: FingerprintInput): Promise<string> {
  const canonical = JSON.stringify({
    locationName: input.locationName,
    severity: input.severity,
    expectedDelayDays: input.expectedDelayDays,
    erpProvider: input.erpProvider,
    atRiskSkus: [...input.atRiskSkus]
      .map((s) => ({ sku: s.sku, unitsShort: s.unitsShort, transferUnits: s.transferUnits }))
      .sort((a, b) => a.sku.localeCompare(b.sku)),
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
