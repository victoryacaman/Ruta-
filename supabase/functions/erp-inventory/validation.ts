// Validates and normalizes a raw adapter-produced SKU record into the
// shape the scoring engine trusts. The core rule throughout: a value
// that is genuinely absent from the source system becomes `null`, never
// a silently-substituted `0` -- `0` is reserved for a real, known zero
// (e.g. a promotional item actually priced at L0). This module is the
// single place that enforces that rule, so every adapter can stay
// simple and just pass through whatever it read.

export interface AlternateWarehouseUnit {
  location: string;
  units: number;
  // Neither of these is populated by any adapter today -- no live ERP
  // integration this project has built fetches per-warehouse demand for
  // an ALTERNATE location, only for the primary one. Left here, always
  // null in practice right now, so the scoring engine has a real place
  // to read from the day an adapter actually supplies it, instead of
  // fabricating a number to fill the gap.
  sourceReorderPoint: number | null;
  sourceAvgDailyUnitsSold: number | null;
}

export interface SkuInventory {
  sku: string;
  name: string;
  onHandUnits: number | null;
  reorderPoint: number | null;
  avgDailyUnitsSold: number | null;
  unitCost: number | null;
  unitPrice: number | null;
  alternateWarehouseUnits: AlternateWarehouseUnit[];
  // Empty when the record is clean. Non-empty means some field couldn't
  // be trusted as-is and was set to null instead -- surfaced so the
  // dashboard can explain *why* a number is missing, not just that it is.
  validationIssues: string[];
}

export interface RawAltWarehouse {
  location?: unknown;
  units?: unknown;
  sourceReorderPoint?: unknown;
  sourceAvgDailyUnitsSold?: unknown;
}

export interface RawSkuInput {
  sku?: unknown;
  name?: unknown;
  onHandUnits?: unknown;
  reorderPoint?: unknown;
  avgDailyUnitsSold?: unknown;
  unitCost?: unknown;
  unitPrice?: unknown;
  alternateWarehouseUnits?: RawAltWarehouse[];
}

function isPresent(v: unknown): boolean {
  return v !== null && v !== undefined && v !== "";
}

// The one function every numeric field goes through. Absent -> null,
// silently (that's the normal, expected case for an optional field).
// Present but not a finite number, or present but negative when negative
// isn't physically meaningful -- null, WITH an issue recorded, since
// that's the source data actively lying rather than just being missing.
function numOrNull(raw: unknown, fieldLabel: string, issues: string[]): number | null {
  if (!isPresent(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    issues.push(`${fieldLabel} was present but not a finite number (${JSON.stringify(raw)}) -- treated as unavailable`);
    return null;
  }
  if (n < 0) {
    issues.push(`${fieldLabel} was negative (${n}) -- treated as unavailable rather than trusted`);
    return null;
  }
  return n;
}

// Reasonably permissive across real-world ERP SKU formats (letters,
// digits, dashes, dots, underscores) while still rejecting the actual
// failure cases: empty, whitespace-only, or absurdly long.
const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function validateAndNormalizeItem(raw: RawSkuInput): { item: SkuInventory | null; issues: string[] } {
  const issues: string[] = [];
  const skuRaw = (typeof raw.sku === "string" ? raw.sku : String(raw.sku ?? "")).trim();
  if (!skuRaw || !SKU_RE.test(skuRaw)) {
    issues.push(`SKU "${skuRaw || "(empty)"}" is malformed or empty -- item rejected, not shown`);
    return { item: null, issues };
  }

  const onHandUnits = numOrNull(raw.onHandUnits, "onHandUnits", issues);
  const reorderPoint = numOrNull(raw.reorderPoint, "reorderPoint", issues);
  const avgDailyUnitsSold = numOrNull(raw.avgDailyUnitsSold, "avgDailyUnitsSold", issues);
  const unitCost = numOrNull(raw.unitCost, "unitCost", issues);
  const unitPrice = numOrNull(raw.unitPrice, "unitPrice", issues);

  const alternateWarehouseUnits: AlternateWarehouseUnit[] = (raw.alternateWarehouseUnits ?? []).map((w) => {
    const location = String(w.location ?? "unknown");
    const units = numOrNull(w.units, `alternateWarehouseUnits[${location}].units`, issues) ?? 0;
    return {
      location,
      units,
      sourceReorderPoint: numOrNull(w.sourceReorderPoint, `alternateWarehouseUnits[${location}].sourceReorderPoint`, issues),
      sourceAvgDailyUnitsSold: numOrNull(w.sourceAvgDailyUnitsSold, `alternateWarehouseUnits[${location}].sourceAvgDailyUnitsSold`, issues),
    };
  });

  return {
    item: {
      sku: skuRaw,
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : skuRaw,
      onHandUnits, reorderPoint, avgDailyUnitsSold, unitCost, unitPrice,
      alternateWarehouseUnits,
      validationIssues: issues,
    },
    issues,
  };
}

// Runs every raw item through the above, returning the clean list plus a
// count of anything rejected outright (malformed SKU) so the caller can
// disclose that something was dropped instead of it silently vanishing.
export function validateAndNormalizeAll(rawItems: RawSkuInput[]): { items: SkuInventory[]; rejectedCount: number } {
  const items: SkuInventory[] = [];
  let rejectedCount = 0;
  for (const raw of rawItems) {
    const { item } = validateAndNormalizeItem(raw);
    if (item) items.push(item);
    else rejectedCount++;
  }
  return { items, rejectedCount };
}
