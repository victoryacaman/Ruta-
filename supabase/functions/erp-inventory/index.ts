import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { requireAuthorizedUser } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { validateAndNormalizeAll, type RawSkuInput } from "./validation.ts";
import { mapExcelRows, resolveColumns, validateMoneyHeaders } from "./excelMapping.ts";
import { inventoryContext, inventoryScope } from "../_shared/inventoryContext.ts";

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
//
// WORKBOOK COMPATIBILITY (2026-09-28/29): excelMapping.ts/money.ts add
// bilingual (Spanish/English) header aliases and tolerant HNL/USD
// currency parsing, plus an inventory_context (environment/currency/
// unitsConfirmed) declaration bound to the exact connected workbook+table
// -- see _shared/inventoryContext.ts. None of this fabricates data a
// real customer's sheet doesn't have; it only widens which real header
// text is recognized and which money formats parse.

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
  inventory_context?: unknown;
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

interface ExcelAdapterResult {
  items: RawSkuInput[];
  // The connected workbook's own Graph `lastModifiedDateTime`, or null if
  // it couldn't be read -- never guessed. See _shared/freshness.ts for
  // how this becomes a staleness verdict (that's risk-recommendation's
  // job, not this function's -- it would need risk_location_config's
  // threshold, which this function has no reason to read).
  lastModifiedDateTime: string | null;
}

async function excelAdapter(config: ErpConfig, supabase: SupabaseClient<any>): Promise<ExcelAdapterResult> {
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
  const context = inventoryContext(config);
  validateMoneyHeaders(headers, columns, context.currencyCode);

  const rowsRes = await fetch(`${tableUrl}/rows`, { headers: authHeaders });
  if (!rowsRes.ok) {
    const errBody = await rowsRes.text();
    throw new Error(`Excel workbook read failed (${rowsRes.status}): ${errBody.slice(0, 300)}`);
  }
  const rowsJson = await rowsRes.json();

  // Freshness (2026-10-01): read live on every call, not cached from
  // selection time -- it should reflect whether the CUSTOMER'S workbook
  // has actually been touched recently, not a snapshot from whenever
  // they first connected it. Best-effort: a failed metadata read never
  // fails the whole inventory fetch, it just leaves freshness unknown.
  let lastModifiedDateTime: string | null = null;
  try {
    const metaRes = await fetch(`${baseItemUrl}?$select=lastModifiedDateTime`, { headers: authHeaders });
    if (metaRes.ok) {
      const metaJson = await metaRes.json();
      lastModifiedDateTime = typeof metaJson.lastModifiedDateTime === "string" ? metaJson.lastModifiedDateTime : null;
    }
  } catch (_e) {
    lastModifiedDateTime = null;
  }

  return { items: mapExcelRows(columns, rowsJson.value ?? [], context.currencyCode), lastModifiedDateTime };
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
    // Only the excel adapter has a real, source-reported last-modified
    // timestamp to offer -- every other provider stays null (unknown),
    // never a guessed/fabricated freshness verdict.
    let lastModifiedDateTime: string | null = null;
    if (provider === "odoo") rawItems = await odooAdapter(config as ErpConfig);
    else if (provider === "sap_b1") rawItems = await sapB1Adapter(config as ErpConfig);
    else if (provider === "excel") {
      const excelResult = await excelAdapter(config as ErpConfig, supabase);
      rawItems = excelResult.items;
      lastModifiedDateTime = excelResult.lastModifiedDateTime;
    } else if (provider === "zafracloud") rawItems = await zafraCloudAdapter(config as ErpConfig);
    else rawItems = demoAdapter();

    // Every adapter's raw output goes through the same validation pass
    // before it ever reaches a caller -- this is the one place null vs.
    // zero, malformed SKUs, and negative/non-finite values get decided,
    // regardless of which adapter produced the data.
    const { items, rejectedCount } = validateAndNormalizeAll(rawItems);

    return new Response(
      JSON.stringify({ ok: true, provider, fetchedAt: new Date().toISOString(), items, rejectedCount,
        inventoryContext: inventoryContext(config ?? { provider: "demo" }), inventoryScope: await inventoryScope(config),
        dataFreshness: { lastModifiedAtIso: lastModifiedDateTime } }),
      { headers: corsHeaders(req) },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 502, headers: corsHeaders(req) },
    );
  }
});
