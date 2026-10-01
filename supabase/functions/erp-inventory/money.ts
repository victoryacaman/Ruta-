import type { CurrencyCode } from "../_shared/inventoryContext.ts";

// A bare dollar sign requires an explicit USD declaration.
const MARKER = /(?:\b(?:HNL|USD|LPS\.?|LEMPIRAS?|D[ÓO]LARES?)(?=\W|\d|$)|US\$|\$|\bL\.(?=\s|\d|$)|\bL(?=\s|\d|$))/giu;
export function moneyMarkers(text: string): (CurrencyCode | "dollar")[] {
  return [...text.matchAll(MARKER)].map((m) =>
    /^(USD|US\$|D[ÓO]LARES?)$/i.test(m[0]) ? "USD" : m[0] === "$" ? "dollar" : "HNL"
  );
}
export function validateMoneyCurrency(text: string, declared: CurrencyCode | null) {
  const markers = moneyMarkers(text);
  const explicit = new Set(markers.filter((m) => m !== "dollar"));
  if (explicit.size > 1 || (declared && [...explicit].some((m) => m !== declared)) ||
      (markers.includes("dollar") && declared !== "USD")) {
    throw new Error("Monedas mezcladas o ambiguas; confirme HNL o USD. / Mixed or ambiguous currencies; confirm HNL or USD.");
  }
}
export function parseMoney(value: unknown, declared: CurrencyCode | null): number | undefined {
  if (value == null || (typeof value === "string" && !value.trim())) return undefined;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : NaN;
  if (typeof value !== "string") return NaN;
  validateMoneyCurrency(value, declared);
  const text = value.replace(MARKER, "").trim();
  // 1,234 / 1.234 could be grouping or a decimal: do not guess.
  if (/^\d+(?:\.\d{1,2})?$/.test(text)) return Number(text);
  if (/^\d+,\d{1,2}$/.test(text)) return Number(text.replace(",", "."));
  if (/^\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(text)) return Number(text.replaceAll(",", ""));
  if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(text)) return Number(text.replaceAll(".", "").replace(",", "."));
  return NaN;
}
