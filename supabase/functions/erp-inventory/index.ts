import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireAuthorizedUser } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { validateAndNormalizeAll, type RawSkuInput } from "./validation.ts";

// Read-only ERP connector (build order step 3). No write capability
// exists in this function at all. Reads erp_config (RLS locked to
// service_role) and dispatches to one of five adapters behind one
// common shape. Never returns credentials -- only
// {ok, provider, fetchedAt, items, rejectedCount}.
//
// SECURITY HARDENING (2026-09-22): this function returns real customer
// inventory once a real ERP/Excel is connected, so it's no longer left
// open -- every request must carry a valid, allowlisted user session.
// risk-recommendation's own internal call to this function forwards the
// original caller's real token rather than a broad internal credential
// (see _shared/auth.ts and risk-recommendation/index.ts, 2026-09-23).
//
// DATA INTEGRITY HARDENING (2026-09-22): every adapter below used to
// collapse a genuinely-missing unitCost/unitPrice/reorderPoint into a
// silent 0 (`?? 0` / `|| 0`) -- indistinguishable from a real zero, and
// specifically caught turning "no Unit Price column in this sheet" into
// a false "priced at L0" once already (see BUILD_LOG.md). Every adapter
// now passes through whatever it actually read (including nothing at
// all) to validateAndNormalizeAll, in validation.ts, which is the single
// place that decides null vs. a real number -- and also rejects
// malformed SKUs and flags negative/non-finite values rather than
// trusting them.

interface ErpConfig {
  provider: "demo" | "odoo" | "sap_b1" | "excel" | "zafracloud";
  base_url: string | null;
  database_name: string | null;
  company_db: string | null;
  username: string | null;
  password: string | null;
  sku_shortlist: string[];
  excel_workbook_id: string | null;
  excel_workbook_path: string | null;
  excel_table_name: string | null;
  api_token: string | null;
}

function demoAdapter(): RawSkuInput[] {
  return [
    {
      sku: "AUT-2201", name: "12V LED Headlight Kit",
      onHandUnits: 96, reorderPoint: 250, avgDailyUnitsSold: 14,
      unitCost: 145.0, unitPrice: 249.0,
      alternateWarehouseUnits: [{ location: "Tegucigalpa", units: 240 }],
    },
    {
      sku: "AUT-3387", name: "Ceramic Brake Pad Set (Front)",
      onHandUnits: 130, reorderPoint: 300, avgDailyUnitsSold: 18,
      unitCost: 210.0, unitPrice: 349.0,
      alternateWarehouseUnits: [{ location: "Tegucigalpa", units: 120 }],
    },
    {
      sku: "AUT-4410", name: "12V Car Battery 650CCA",
      onHandUnits: 40, reorderPoint: 150, avgDailyUnitsSold: 9,
      unitCost: 980.0, unitPrice: 1450.0,
      alternateWarehouseUnits: [{ location: "Tegucigalpa", units: 60 }],
    },
  ];
}

async function odooCall(baseUrl: string, service: string, method: string, args: unknown[]) {
  const res = await fetch(`${baseUrl}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", method: "call",
      params: { service, method, args },
      id: Math.floor(Math.random() * 1e6),
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Odoo JSON-RPC error: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function odooAdapter(config: ErpConfig): Promise<RawSkuInput[]> {
  const { base_url, database_name, username, password, sku_shortlist } = config;
  if (!base_url || !database_name || !username || !password) {
    throw new Error("Odoo config incomplete: base_url, database_name, username, password all required");
  }
  const uid = await odooCall(base_url, "common", "authenticate", [database_name, username, password, {}]);
  if (!uid) throw new Error("Odoo authentication failed");

  const products = await odooCall(base_url, "object", "execute_kw", [
    database_name, uid, password,
    "product.product", "search_read",
    [[["default_code", "in", sku_shortlist]]],
    { fields: ["default_code", "name", "qty_available", "reordering_min_qty", "standard_price", "list_price"] },
  ]);

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  let salesLines: any[] = [];
  try {
    salesLines = await odooCall(base_url, "object", "execute_kw", [
      database_name, uid, password,
      "sale.order.line", "search_read",
      [[["product_id.default_code", "in", sku_shortlist], ["order_id.date_order", ">=", since]]],
      { fields: ["product_id", "product_uom_qty"] },
    ]);
  } catch (_e) {
    salesLines = [];
  }

  return products.map((p: any) => {
    const qtySold = salesLines
      .filter((l) => Array.isArray(l.product_id) && l.product_id[1] === p.name)
      .reduce((sum, l) => sum + (l.product_uom_qty ?? 0), 0);
    return {
      sku: p.default_code, name: p.name,
      onHandUnits: p.qty_available, reorderPoint: p.reordering_min_qty,
      avgDailyUnitsSold: salesLines.length ? qtySold / 30 : null,
      unitCost: p.standard_price, unitPrice: p.list_price,
      alternateWarehouseUnits: [],
    };
  });
}

async function sapB1Adapter(config: ErpConfig): Promise<RawSkuInput[]> {
  const { base_url, company_db, username, password, sku_shortlist } = config;
  if (!base_url || !company_db || !username || !password) {
    throw new Error("SAP B1 config incomplete: base_url, company_db, username, password all required");
  }
  const loginRes = await fetch(`${base_url}/b1s/v1/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ CompanyDB: company_db, UserName: username, Password: password }),
  });
  if (!loginRes.ok) throw new Error(`SAP B1 login failed: ${loginRes.status}`);
  const setCookie = loginRes.headers.get("set-cookie") ?? "";
  const sessionCookie = setCookie.split(";")[0];
  if (!sessionCookie) throw new Error("SAP B1 login did not return a session cookie");

  const filter = sku_shortlist.map((s) => `ItemCode eq '${s}'`).join(" or ");
  const itemsRes = await fetch(`${base_url}/b1s/v1/Items?$filter=${encodeURIComponent(filter)}`, {
    headers: { Cookie: sessionCookie },
  });
  if (!itemsRes.ok) throw new Error(`SAP B1 Items query failed: ${itemsRes.status}`);
  const itemsJson = await itemsRes.json();

  // DATA INTEGRITY (2026-09-22): these used to fall back to 0 with
  // `?? 0`, indistinguishable from a real zero. Pass through whatever
  // SAP actually returned (including nothing) and let validation.ts
  // decide null vs. a real number.
  return (itemsJson.value ?? []).map((item: any) => ({
    sku: item.ItemCode, name: item.ItemName,
    onHandUnits: item.QuantityOnStock,
    reorderPoint: item.MinimumStock,
    avgDailyUnitsSold: null,
    unitCost: item.AvgStdPrice,
    unitPrice: item.LastPurchasePrice,
    // SAP B1's Service Layer may expose a per-warehouse minimum stock on
    // ItemWarehouseInfoCollection in some configurations, but that hasn't
    // been confirmed against a real instance -- not read here rather
    // than guess at a field name. sourceReorderPoint/
    // sourceAvgDailyUnitsSold stay null (honest gap, not invented) until
    // that's verified against a live SAP B1 account.
    alternateWarehouseUnits: (item.ItemWarehouseInfoCollection ?? [])
      .filter((w: any) => (w.InStock ?? 0) > 0)
      .map((w: any) => ({ location: w.WarehouseCode, units: w.InStock, sourceReorderPoint: null, sourceAvgDailyUnitsSold: null })),
  }));
}

const MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

function encodeGraphPath(path: string): string {
  return path.split("/").map((seg) => (seg ? encodeURIComponent(seg) : "")).join("/");
}

function normalizeHeader(s: string): string {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
}

const HEADER_ALIASES: Record<string, string[]> = {
  sku: ["sku", "sku code", "item code", "product code", "code"],
  name: ["name", "product name", "item name", "description"],
  onHandUnits: ["onhandunits", "on hand units", "quantity on hand", "qty on hand", "on hand", "quantity", "qty", "stock"],
  reorderPoint: ["reorderpoint", "reorder point", "reorder level", "reorder qty", "min stock", "minimum stock"],
  avgDailyUnitsSold: ["avgdailyunitssold", "avg daily units sold", "average daily sales", "avg daily sales", "daily sales"],
  unitCost: ["unitcost", "unit cost", "unit cost (usd)", "cost", "cost per unit"],
  unitPrice: ["unitprice", "unit price", "unit price (usd)", "selling price", "price"],
  altWarehouseLocation: ["altwarehouselocation", "alt warehouse location", "alternate warehouse location", "alternate warehouse", "backup warehouse"],
  altWarehouseUnits: ["altwarehouseunits", "alt warehouse units", "alternate warehouse units", "backup warehouse units"],
  // Not part of the original documented template -- recognized the same
  // way as every other column (by header name, honestly absent if not
  // found) so a customer whose sheet DOES track the alternate
  // warehouse's own reorder point/sales rate can get transfer
  // verification (see risk-recommendation/scoring.ts) without a code
  // change. Nothing invents this data if the column isn't there.
  altWarehouseReorderPoint: ["altwarehousereorderpoint", "alt warehouse reorder point", "alternate warehouse reorder point", "source warehouse reorder point"],
  altWarehouseAvgDailyUnitsSold: ["altwarehouseavgdailyunitssold", "alt warehouse avg daily sales", "alternate warehouse daily sales", "source warehouse daily sales"],
};

function resolveColumns(headers: string[]): Record<string, number> {
  const normalized = headers.map(normalizeHeader);
  const resolved: Record<string, number> = {};
  for (const field of Object.keys(HEADER_ALIASES)) {
    const aliases = HEADER_ALIASES[field].map(normalizeHeader);
    resolved[field] = normalized.findIndex((h) => aliases.includes(h));
  }
  return resolved;
}

async function excelAdapter(config: ErpConfig, supabase: ReturnType<typeof createClient>): Promise<RawSkuInput[]> {
  const { data: oauth, error: oauthError } = await supabase
    .from("excel_oauth")
    .select("id, client_id, client_secret, access_token, refresh_token, token_expires_at")
    .limit(1)
    .maybeSingle();
  if (oauthError) throw oauthError;
  if (!oauth?.refresh_token) {
    throw new Error("Excel not connected yet — click \"Connect with Microsoft\" in Add tools");
  }

  let accessToken = oauth.access_token as string;
  const expiresAt = oauth.token_expires_at ? new Date(oauth.token_expires_at as string).getTime() : 0;
  const needsRefresh = !accessToken || expiresAt < Date.now() + 5 * 60 * 1000;

  if (needsRefresh) {
    if (!oauth.client_id || !oauth.client_secret) {
      throw new Error("Excel connector isn't fully configured — missing Azure client credentials");
    }
    const refreshRes = await fetch(MS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: oauth.client_id as string,
        client_secret: oauth.client_secret as string,
        refresh_token: oauth.refresh_token as string,
        grant_type: "refresh_token",
      }),
    });
    const refreshJson = await refreshRes.json();
    if (!refreshRes.ok || !refreshJson.access_token) {
      throw new Error(`Excel token refresh failed: ${refreshJson.error_description ?? refreshJson.error ?? refreshRes.status}`);
    }
    accessToken = refreshJson.access_token;
    await supabase
      .from("excel_oauth")
      .update({
        access_token: refreshJson.access_token,
        refresh_token: refreshJson.refresh_token ?? oauth.refresh_token,
        token_expires_at: new Date(Date.now() + (refreshJson.expires_in ?? 3600) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", oauth.id);
  }

  const tableName = config.excel_table_name || "InventoryTable";
  const baseItemUrl = config.excel_workbook_id
    ? `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(config.excel_workbook_id)}`
    : `https://graph.microsoft.com/v1.0/me/drive/root:${encodeGraphPath(config.excel_workbook_path || "/Utopia-Inventory.xlsx")}:`;
  const tableUrl = `${baseItemUrl}/workbook/tables('${encodeURIComponent(tableName)}')`;
  const authHeaders = { Authorization: `Bearer ${accessToken}` };

  const headerRes = await fetch(`${tableUrl}/headerRowRange`, { headers: authHeaders });
  if (!headerRes.ok) {
    const errBody = await headerRes.text();
    throw new Error(`Excel header row read failed (${headerRes.status}): ${errBody.slice(0, 300)}`);
  }
  const headerJson = await headerRes.json();
  const headers: string[] = (headerJson.values?.[0] ?? []).map((h: any) => String(h ?? ""));
  const columns = resolveColumns(headers);
  if (columns.sku < 0) {
    throw new Error(`Could not find a SKU column in this table's headers (saw: ${headers.join(", ") || "(no headers)"})`);
  }

  const rowsRes = await fetch(`${tableUrl}/rows`, { headers: authHeaders });
  if (!rowsRes.ok) {
    const errBody = await rowsRes.text();
    throw new Error(`Excel workbook read failed (${rowsRes.status}): ${errBody.slice(0, 300)}`);
  }
  const rowsJson = await rowsRes.json();

  // DATA INTEGRITY (2026-09-22): a cell that's blank or has no matching
  // column used to become `Number(undefined) || 0` -- a real number
  // masquerading as a known zero. numOrUndef leaves it genuinely absent
  // instead, so validation.ts (not this adapter) is what decides null
  // vs. a real value.
  const numOrUndef = (v: unknown): number | undefined =>
    v === "" || v == null ? undefined : Number(v);

  const bySku = new Map<string, RawSkuInput>();
  for (const row of rowsJson.value ?? []) {
    const cells: any[] = row.values?.[0] ?? [];
    const get = (field: string) => (columns[field] >= 0 ? cells[columns[field]] : undefined);

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
        unitCost: numOrUndef(get("unitCost")),
        unitPrice: numOrUndef(get("unitPrice")),
        alternateWarehouseUnits: [],
      });
    }
    const altLoc = get("altWarehouseLocation");
    if (altLoc) {
      bySku.get(skuStr)!.alternateWarehouseUnits!.push({
        location: String(altLoc),
        units: numOrUndef(get("altWarehouseUnits")) ?? 0,
        sourceReorderPoint: numOrUndef(get("altWarehouseReorderPoint")) ?? null,
        sourceAvgDailyUnitsSold: numOrUndef(get("altWarehouseAvgDailyUnitsSold")) ?? null,
      });
    }
  }
  return Array.from(bySku.values());
}

async function zafraCloudFetch(config: ErpConfig, path: string, retriesLeft = 3): Promise<any> {
  const res = await fetch(`${config.base_url}${path}`, {
    headers: { Authorization: `Bearer ${config.api_token}` },
  });
  if (res.status === 429 && retriesLeft > 0) {
    const retryAfterHeader = Number(res.headers.get("Retry-After"));
    const waitMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
      ? retryAfterHeader * 1000
      : 1000 * 2 ** (3 - retriesLeft);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return zafraCloudFetch(config, path, retriesLeft - 1);
  }
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`ZafraCloud request failed (${res.status}) for ${path}: ${errBody.slice(0, 300)}`);
  }
  return res.json();
}

interface ZafraListItem {
  ServicioId: number;
  codigo: string;
  nombre: string;
  stock: { BodegaId: number; Existencias: number; NombreBodega: string }[];
  precios: { nombre: string; precioConImpuesto: number }[];
}

// DATA INTEGRITY (2026-09-22): basePrice/reorderPoint/unitCost used to
// fall back to 0 with `?? 0` / `|| 0` whenever ZafraCloud's response
// didn't have the field -- indistinguishable from a real L0. Now left
// undefined (validation.ts's job to turn that into null, not this
// adapter's).
async function enrichZafraCloudItem(config: ErpConfig, item: ZafraListItem): Promise<RawSkuInput> {
  const basePrice = item.precios?.find((p) => p.nombre === "base")?.precioConImpuesto
    ?? item.precios?.[0]?.precioConImpuesto;
  const warehouses = item.stock ?? [];
  const primary = warehouses[0];
  // ZafraCloud's per-SKU detail call below only ever fetches the
  // PRIMARY warehouse's reorder point -- it doesn't expose one for each
  // alternate warehouse, so sourceReorderPoint/sourceAvgDailyUnitsSold
  // stay null for alternates (honest gap, not invented).
  const alternateWarehouseUnits = warehouses.slice(1).map((w) => ({
    location: w.NombreBodega, units: w.Existencias, sourceReorderPoint: null, sourceAvgDailyUnitsSold: null,
  }));

  let reorderPoint: number | undefined;
  let unitCost: number | undefined;
  let avgDailyUnitsSold: number | null = null;
  try {
    const detail = await zafraCloudFetch(
      config,
      `/integracion/servicios/movimientos?servicioid=${encodeURIComponent(String(item.ServicioId))}&limit=100`,
    );
    const stockDetail = detail.data?.stock ?? [];
    const primaryDetail = stockDetail[0];
    if (primaryDetail) {
      reorderPoint = primaryDetail.existenciaMin != null ? Number(primaryDetail.existenciaMin) : undefined;
      unitCost = primaryDetail.costoPromedio != null ? Number(primaryDetail.costoPromedio) : undefined;
    }
    const movimientos = detail.data?.movimientos?.data ?? [];
    const since = Date.now() - 30 * 24 * 3600 * 1000;
    const ventas = movimientos.filter((m: any) =>
      m.tipoMovimiento?.nombre === "Venta" && new Date(m.fechaCreacion).getTime() >= since
    );
    if (ventas.length) {
      const totalSold = ventas.reduce((s: number, m: any) => s + (Number(m.cantidad) || 0), 0);
      avgDailyUnitsSold = totalSold / 30;
    }
  } catch (_e) {
    // best-effort
  }

  return {
    sku: item.codigo,
    name: item.nombre,
    onHandUnits: primary ? Number(primary.Existencias) : undefined,
    reorderPoint,
    avgDailyUnitsSold,
    unitCost,
    unitPrice: basePrice,
    alternateWarehouseUnits,
  };
}

const ZAFRA_MAX_SKUS = 50;
const ZAFRA_CONCURRENCY = 10;

async function zafraCloudAdapter(config: ErpConfig): Promise<RawSkuInput[]> {
  if (!config.base_url || !config.api_token) {
    throw new Error("ZafraCloud config incomplete: base_url and api_token both required");
  }

  const listed: ZafraListItem[] = [];
  let page = 1;
  const limit = 100;
  while (true) {
    const json = await zafraCloudFetch(config, `/integracion/v2/servicios?page=${page}&limit=${limit}`);
    const rows: ZafraListItem[] = json.data ?? [];
    listed.push(...rows);
    const totalPages = json.pagination?.totalPages ?? 1;
    if (page >= totalPages || rows.length === 0) break;
    page++;
  }

  const shortlist = config.sku_shortlist?.length ? new Set(config.sku_shortlist) : null;
  const filtered = shortlist ? listed.filter((item) => shortlist.has(item.codigo)) : listed;

  if (filtered.length > ZAFRA_MAX_SKUS) {
    console.warn(`zafraCloudAdapter: ${filtered.length} SKUs exceeds the ${ZAFRA_MAX_SKUS}-SKU safety cap -- truncating.`);
  }
  const capped = filtered.slice(0, ZAFRA_MAX_SKUS);

  const items: RawSkuInput[] = [];
  for (let i = 0; i < capped.length; i += ZAFRA_CONCURRENCY) {
    const batch = capped.slice(i, i + ZAFRA_CONCURRENCY);
    const batchResults = await Promise.all(batch.map((item) => enrichZafraCloudItem(config, item)));
    items.push(...batchResults);
  }
  return items;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handlePreflight(req);

  const auth = await requireAuthorizedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: config, error: configError } = await supabase
      .from("erp_config")
      .select("*")
      .limit(1)
      .maybeSingle();
    if (configError) throw configError;

    const provider = (config?.provider ?? "demo") as ErpConfig["provider"];
    let rawItems: RawSkuInput[];
    if (provider === "odoo") rawItems = await odooAdapter(config as ErpConfig);
    else if (provider === "sap_b1") rawItems = await sapB1Adapter(config as ErpConfig);
    else if (provider === "excel") rawItems = await excelAdapter(config as ErpConfig, supabase);
    else if (provider === "zafracloud") rawItems = await zafraCloudAdapter(config as ErpConfig);
    else rawItems = demoAdapter();

    // Every adapter's raw output goes through the same validation pass
    // before it ever reaches a caller -- this is the one place null vs.
    // zero, malformed SKUs, and negative/non-finite values get decided,
    // regardless of which adapter produced the data.
    const { items, rejectedCount } = validateAndNormalizeAll(rawItems);

    return new Response(
      JSON.stringify({ ok: true, provider, fetchedAt: new Date().toISOString(), items, rejectedCount }),
      { headers: corsHeaders(req) },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 502, headers: corsHeaders(req) },
    );
  }
});
