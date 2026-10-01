import type { RawSkuInput } from "./validation.ts";
import { parseMoney, validateMoneyCurrency } from "./money.ts";
import type { CurrencyCode } from "../_shared/inventoryContext.ts";

// Exact, documented aliases, not fuzzy guesses about a customer's data.
// Accents, capitalization, spaces and punctuation do not affect matching.
export function normalizeHeader(header: string): string {
  return header.normalize("NFKD").toLowerCase()
    .replace(/\p{M}/gu, "").replace(/[^a-z0-9]/g, "");
}

export const HEADER_ALIASES = {
  sku: [
    "sku",
    "sku code",
    "item code",
    "product code",
    "code",
    "código",
    "código producto",
    "código de producto",
    "código del producto",
    "código artículo",
    "código de artículo",
    "código del artículo",
    "código SKU",
    "código de SKU",
    "cod.",
    "cod producto",
    "cod de producto",
    "cod artículo",
    "cod SKU",
    "clave del producto",
  ],
  name: [
    "name",
    "product name",
    "item name",
    "description",
    "nombre",
    "nombre producto",
    "nombre del producto",
    "nombre de producto",
    "nombre del artículo",
    "nombre de artículo",
    "descripción",
    "descripción del producto",
    "artículo",
    "producto",
    "descrip.",
    "desc producto",
    "detalle del producto",
  ],
  onHandUnits: [
    "onhandunits",
    "on hand units",
    "quantity on hand",
    "qty on hand",
    "on hand",
    "quantity",
    "qty",
    "stock",
    "existencias",
    "existencia",
    "cantidad",
    "cantidad disponible",
    "cantidad en existencia",
    "cantidad en existencias",
    "cantidad en inventario",
    "unidades disponibles",
    "unidades en existencia",
    "inventario disponible",
    "stock actual",
    "stock disponible",
    "cant.",
    "cant disponible",
    "cant actual",
    "cant en existencia",
    "exist.",
    "exist actual",
    "existencias actuales",
    "saldo en unidades",
  ],
  reorderPoint: [
    "reorderpoint",
    "reorder point",
    "reorder level",
    "reorder qty",
    "min stock",
    "minimum stock",
    "punto de reorden",
    "nivel de reorden",
    "cantidad de reorden",
    "punto de pedido",
    "stock mínimo",
    "existencia mínima",
    "existencias mínimas",
    "inventario mínimo",
    "min.",
    "mínimo",
    "nivel mínimo",
    "cant mínima",
    "exist mín",
    "punto reorden",
  ],
  avgDailyUnitsSold: [
    "avgdailyunitssold",
    "avg daily units sold",
    "average daily sales",
    "avg daily sales",
    "daily sales",
    "ventas diarias promedio",
    "ventas promedio diarias",
    "promedio de ventas diarias",
    "promedio diario de ventas",
    "ventas diarias",
    "unidades vendidas por día",
    "unidades vendidas al día",
    "promedio diario de unidades vendidas",
    "promedio de unidades vendidas por día",
    "ventas diarias promedio (unidades)",
    "ventas diarias (unidades)",
    // Everyday shorthand still needs a daily marker. Bare "ventas",
    // "salidas" or "movimiento" do not identify a daily unit quantity.
    "venta prom/dia",
    "ventas prom/dia",
    "venta prom diaria",
    "ventas prom diarias",
    "vta prom diaria",
    "vtas prom diarias",
    "vta diaria",
    "vtas diarias",
    "prom unidades/dia",
    "prom und/dia",
    "uds vendidas por día",
    "und vendidas por día",
    "unid vendidas al día",
  ],
  unitCost: [
    "unitcost",
    "unit cost",
    "unit cost (usd)",
    "cost",
    "cost per unit",
    "costo",
    "coste",
    "costo unitario",
    "coste unitario",
    "costo por unidad",
    "coste por unidad",
    "costo unitario (USD)",
    "coste unitario (USD)",
    "costo unit.",
    "costo/u",
    "costo x unidad",
    "costo por und",
    "costo por unid",
  ],
  unitPrice: [
    "unitprice",
    "unit price",
    "unit price (usd)",
    "selling price",
    "price",
    "precio",
    "precio unitario",
    "precio por unidad",
    "precio de venta",
    "precio de venta unitario",
    "precio unitario (USD)",
    "precio unit.",
    "precio/u",
    "precio x unidad",
    "precio por und",
    "precio venta",
    "p venta",
    "pv unitario",
  ],
  altWarehouseLocation: [
    "altwarehouselocation",
    "alt warehouse location",
    "alternate warehouse location",
    "alternate warehouse",
    "backup warehouse",
    "bodega alternativa",
    "bodega alterna",
    "bodega de respaldo",
    "almacén alternativo",
    "ubicación de bodega alternativa",
    "ubicación de bodega alterna",
    "ubicación de almacén alternativo",
    "otra bodega",
    "bodega respaldo",
    "bod alterna",
    "almacén alterno",
    "alm alterno",
  ],
  altWarehouseUnits: [
    "altwarehouseunits",
    "alt warehouse units",
    "alternate warehouse units",
    "backup warehouse units",
    "unidades bodega alternativa",
    "unidades en bodega alternativa",
    "unidades bodega alterna",
    "existencias bodega alternativa",
    "existencias en bodega alternativa",
    "existencias bodega alterna",
    "stock bodega alternativa",
    "unidades almacén alternativo",
    "cant bodega alterna",
    "cant otra bodega",
    "exist bod alterna",
    "stock otra bodega",
  ],
  // Optional source-warehouse demand fields remain absent if not supplied.
  altWarehouseReorderPoint: [
    "altwarehousereorderpoint",
    "alt warehouse reorder point",
    "alternate warehouse reorder point",
    "source warehouse reorder point",
    "punto de reorden bodega alternativa",
    "punto de reorden de bodega alternativa",
    "punto de reorden bodega alterna",
    "punto de reorden almacén alternativo",
    "stock mínimo bodega alternativa",
    "stock mínimo bodega alterna",
    "min bodega alterna",
    "min otra bodega",
    "exist mín bod alterna",
  ],
  altWarehouseAvgDailyUnitsSold: [
    "altwarehouseavgdailyunitssold",
    "alt warehouse avg daily sales",
    "alternate warehouse daily sales",
    "source warehouse daily sales",
    "ventas diarias promedio bodega alternativa",
    "ventas diarias promedio de bodega alternativa",
    "ventas diarias promedio bodega alterna",
    "ventas diarias bodega alternativa",
    "ventas diarias bodega alterna",
    "ventas diarias promedio almacén alternativo",
    "unidades vendidas por día bodega alternativa",
    "venta prom/dia bodega alterna",
    "vtas diarias otra bodega",
    "prom und/dia bod alterna",
  ],
} as const;

export type ExcelField = keyof typeof HEADER_ALIASES;
export type ExcelColumns = Record<ExcelField, number>;

export function resolveColumns(headers: string[]): ExcelColumns {
  const normalized = headers.map(normalizeHeader);
  const resolved = {} as ExcelColumns;
  for (const field of Object.keys(HEADER_ALIASES) as ExcelField[]) {
    const aliases = new Set(HEADER_ALIASES[field].map(normalizeHeader));
    const matches = normalized.flatMap((header, index) => {
      // Only monetary columns may have a currency qualifier. Never strip
      // HNL/L from a daily-sales column and mistake revenue for unit demand.
      const moneyHeader = field === "unitCost" || field === "unitPrice"
        ? headers[index].replace(/\s*(?:\((?:HNL|L\.?|Lps\.?|lempiras?|USD|US\$)\)|\b(?:HNL|L\.?|Lps\.?|lempiras?|USD)|US\$|\$)\s*$/i, "")
        : headers[index];
      return aliases.has(header) || aliases.has(normalizeHeader(moneyHeader)) ? [index] : [];
    });
    // A bilingual workbook may contain both Stock and Existencias, with
    // different numbers. Reject ambiguity instead of silently picking one.
    if (matches.length > 1) {
      throw new Error(
        `Varias columnas corresponden a ${field}; deje una sola columna para ese dato. / Multiple columns match ${field}; keep one column for this field.`,
      );
    }
    resolved[field] = matches[0] ?? -1;
  }
  if (resolved.sku < 0) {
    throw new Error(
      "No se encontró una columna SKU o Código del producto. / Could not find a SKU or product code column.",
    );
  }
  return resolved;
}

export function validateMoneyHeaders(headers: string[], columns: ExcelColumns, currency: CurrencyCode | null) {
  const moneyHeaders = [columns.unitCost, columns.unitPrice].filter((i) => i >= 0).map((i) => headers[i]);
  validateMoneyCurrency(moneyHeaders.join(" "), currency);
}

export interface ExcelRow {
  values?: unknown[][];
}

// Used by the live adapter and isolated fixtures alike. Header recognition
// changes no units, currency, product text, or existing SKU grouping rules.
export function mapExcelRows(
  columns: ExcelColumns,
  rows: ExcelRow[],
  currency: CurrencyCode | null = null,
): RawSkuInput[] {
  const numOrUndef = (value: unknown): number | undefined =>
    value == null || (typeof value === "string" && !value.trim())
      ? undefined
      : Number(value);
  const bySku = new Map<string, RawSkuInput>();
  validateMoneyCurrency(rows.flatMap((row) => [columns.unitCost, columns.unitPrice]
    .filter((i) => i >= 0).map((i) => String(row.values?.[0]?.[i] ?? ""))).join(" "), currency);
  for (const row of rows) {
    const cells = row.values?.[0] ?? [];
    const get = (field: ExcelField) =>
      columns[field] >= 0 ? cells[columns[field]] : undefined;
    const sku = get("sku");
    if (!sku) continue;
    const skuStr = String(sku);
    if (!bySku.has(skuStr)) {
      bySku.set(skuStr, {
        sku: skuStr,
        name: String(get("name") ?? skuStr),
        onHandUnits: numOrUndef(get("onHandUnits")),
        reorderPoint: numOrUndef(get("reorderPoint")),
        avgDailyUnitsSold: numOrUndef(get("avgDailyUnitsSold")),
        unitCost: parseMoney(get("unitCost"), currency),
        unitPrice: parseMoney(get("unitPrice"), currency),
        alternateWarehouseUnits: [],
      });
    }
    const altLoc = get("altWarehouseLocation");
    if (altLoc) {
      bySku.get(skuStr)!.alternateWarehouseUnits!.push({
        location: String(altLoc),
        units: numOrUndef(get("altWarehouseUnits")) ?? 0,
        sourceReorderPoint: numOrUndef(get("altWarehouseReorderPoint")) ?? null,
        sourceAvgDailyUnitsSold:
          numOrUndef(get("altWarehouseAvgDailyUnitsSold")) ?? null,
      });
    }
  }
  return Array.from(bySku.values());
}
