import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mapExcelRows, resolveColumns } from "../../supabase/functions/erp-inventory/excelMapping.ts";
import { parseMoney, validateMoneyCurrency } from "../../supabase/functions/erp-inventory/money.ts";

// Synthetic workbook fixture battery (no real customer file exists yet --
// see UTOPIA_CURRENT_SPEC.md's Excel/OneDrive adapter section). Exercises
// real-world shapes a Honduran customer's own sheet is likely to use:
// Spanish headers, mixed Spanish/English, Lempiras-formatted prices,
// missing/ambiguous columns -- none of which were covered by a dedicated
// test before this file existed.

function rowsOf(values: unknown[][]): { values: unknown[][] }[] {
  return values.map((row) => ({ values: [row] }));
}

Deno.test("fully Spanish headers resolve every field correctly", () => {
  const headers = ["Código", "Nombre del producto", "Existencias", "Ventas diarias promedio", "Precio unitario"];
  const columns = resolveColumns(headers);
  assertEquals(columns.sku, 0);
  assertEquals(columns.name, 1);
  assertEquals(columns.onHandUnits, 2);
  assertEquals(columns.avgDailyUnitsSold, 3);
  assertEquals(columns.unitPrice, 4);
});

Deno.test("a mixed Spanish/English header row resolves each column independently", () => {
  const headers = ["SKU", "Nombre del producto", "On Hand Units", "ventas diarias promedio", "Unit Price"];
  const columns = resolveColumns(headers);
  assertEquals(columns.sku, 0);
  assertEquals(columns.name, 1);
  assertEquals(columns.onHandUnits, 2);
  assertEquals(columns.avgDailyUnitsSold, 3);
  assertEquals(columns.unitPrice, 4);
});

Deno.test("accents are optional -- 'Codigo' (no accent) matches the same as 'Código'", () => {
  const columns = resolveColumns(["Codigo", "Existencias"]);
  assertEquals(columns.sku, 0);
  assertEquals(columns.onHandUnits, 1);
});

Deno.test("a bilingual sheet with BOTH Stock and Existencias for the same concept is rejected as ambiguous, never silently picks one", () => {
  assertThrows(
    () => resolveColumns(["SKU", "Stock", "Existencias"]),
    Error,
  );
});

Deno.test("no SKU/Código column at all -> fails closed, never guesses a column", () => {
  assertThrows(
    () => resolveColumns(["Nombre", "Existencias"]),
    Error,
  );
});

Deno.test("a currency qualifier in a money header is stripped before matching, but never from a non-money column", () => {
  const columns = resolveColumns(["SKU", "Precio unitario (HNL)", "Ventas diarias promedio"]);
  assertEquals(columns.unitPrice, 1);
  // "Ventas diarias promedio" has no currency marker and must still resolve
  // to avgDailyUnitsSold, not be mistaken for a money column.
  assertEquals(columns.avgDailyUnitsSold, 2);
});

Deno.test("Lempiras-formatted price 'L. 1,450.00' parses to 1450", () => {
  assertEquals(parseMoney("L. 1,450.00", "HNL"), 1450);
});

Deno.test("plain 'HNL 980.50' parses to 980.5", () => {
  assertEquals(parseMoney("HNL 980.50", "HNL"), 980.5);
});

Deno.test("bare 'L249' (no space/period) parses to 249", () => {
  assertEquals(parseMoney("L249", "HNL"), 249);
});

Deno.test("European-style thousands/decimal '1.450,00' parses to 1450", () => {
  assertEquals(parseMoney("1.450,00", "HNL"), 1450);
});

Deno.test("a bare dollar sign requires USD to be the declared currency", () => {
  assertEquals(parseMoney("$249.00", "USD"), 249);
  assertThrows(() => parseMoney("$249.00", "HNL"), Error);
});

Deno.test("a value carrying HNL text when USD is declared is a mixed-currency error, not silently accepted", () => {
  assertThrows(() => validateMoneyCurrency("HNL 100", "USD"), Error);
});

Deno.test("plain, unitless numeric values are accepted regardless of declared currency", () => {
  assertEquals(parseMoney(1450, "HNL"), 1450);
  assertEquals(parseMoney("1450.00", "USD"), 1450);
});

Deno.test("a genuinely malformed money string (not a number, no recognizable format) becomes NaN, not a wrong number", () => {
  const result = parseMoney("ciento cincuenta", "HNL");
  assertEquals(Number.isNaN(result), true);
});

Deno.test("an empty/whitespace money cell is undefined (absent), distinct from a malformed one", () => {
  assertEquals(parseMoney("", "HNL"), undefined);
  assertEquals(parseMoney("   ", "HNL"), undefined);
  assertEquals(parseMoney(null, "HNL"), undefined);
});

Deno.test("mapExcelRows: a full Spanish-header Lempiras workbook maps real rows correctly end to end", () => {
  const headers = ["Código", "Nombre del producto", "Existencias", "Precio unitario"];
  const columns = resolveColumns(headers);
  const rows = rowsOf([
    ["AUT-1001", "Filtro de aceite", 42, "L. 185.00"],
    ["AUT-1002", "Pastillas de freno", 17, "L. 1,250.50"],
  ]);
  const items = mapExcelRows(columns, rows, "HNL");
  assertEquals(items.length, 2);
  assertEquals(items[0].sku, "AUT-1001");
  assertEquals(items[0].onHandUnits, 42);
  assertEquals(items[0].unitPrice, 185);
  assertEquals(items[1].unitPrice, 1250.5);
});

Deno.test("mapExcelRows: a row with no SKU value is silently skipped, not inserted as a broken record", () => {
  const columns = resolveColumns(["SKU", "Existencias"]);
  const rows = rowsOf([["", 10], ["AUT-2000", 5]]);
  const items = mapExcelRows(columns, rows, null);
  assertEquals(items.length, 1);
  assertEquals(items[0].sku, "AUT-2000");
});

Deno.test("mapExcelRows: duplicate SKU rows (e.g. a second alternate-warehouse row) merge into the first row's alternates, never a second top-level item", () => {
  const headers = ["SKU", "Existencias", "Bodega alternativa", "Unidades bodega alternativa"];
  const columns = resolveColumns(headers);
  const rows = rowsOf([
    ["AUT-3000", 20, "Tegucigalpa", 15],
  ]);
  const items = mapExcelRows(columns, rows, null);
  assertEquals(items.length, 1);
  assertEquals(items[0].alternateWarehouseUnits?.length, 1);
  assertEquals(items[0].alternateWarehouseUnits?.[0].location, "Tegucigalpa");
});
