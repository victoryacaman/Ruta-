export type CurrencyCode = "HNL" | "USD";
export type DataEnvironment = "demo" | "pilot" | "unknown";
export interface InventoryContext {
  environment: DataEnvironment;
  currencyCode: CurrencyCode | null;
  unitsConfirmed: boolean;
}
export const UNKNOWN_CONTEXT: InventoryContext = {
  environment: "unknown", currencyCode: null, unitsConfirmed: false,
};

// Bind server-stored declarations to the exact workbook AND table.
// A connector, filename, language, or JWT metadata does not prove a pilot.
export function inventoryContext(config: any): InventoryContext {
  if (config?.provider === "demo") {
    return { environment: "demo", currencyCode: "HNL", unitsConfirmed: true };
  }
  const c = config?.inventory_context;
  if (config?.provider !== "excel" || c?.provider !== "excel" ||
      !config.excel_workbook_id || c.workbookId !== config.excel_workbook_id ||
      c.tableName !== config.excel_table_name ||
      !["demo", "pilot", "unknown"].includes(c.environment) ||
      !["HNL", "USD", null].includes(c.currencyCode) || typeof c.unitsConfirmed !== "boolean") {
    return { ...UNKNOWN_CONTEXT };
  }
  return { environment: c.environment, currencyCode: c.currencyCode, unitsConfirmed: c.unitsConfirmed };
}

export function selectionContext(body: any, workbookId: string, tableName: string) {
  const environment = body.dataEnvironment ?? "unknown";
  const currencyCode = body.currencyCode ?? null;
  const unitsConfirmed = body.unitsConfirmed ?? false;
  if (!["demo", "pilot", "unknown"].includes(environment) ||
      !["HNL", "USD", null].includes(currencyCode) || typeof unitsConfirmed !== "boolean") {
    throw new Error("Invalid inventory context: use HNL/USD, demo/pilot/unknown, and a boolean units confirmation.");
  }
  return { provider: "excel", workbookId, tableName, environment, currencyCode, unitsConfirmed };
}

export async function inventoryScope(config: any): Promise<string> {
  const identity = JSON.stringify({provider: config?.provider ?? "demo",
    workbookId: config?.excel_workbook_id ?? null, tableName: config?.excel_table_name ?? null});
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2,"0")).join("");
}
