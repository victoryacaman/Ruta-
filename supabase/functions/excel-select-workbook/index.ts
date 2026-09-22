import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireAuthorizedUser } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";

// Saves the workbook/table an authorized user picked in the Add tools
// picker. Re-verifies the table actually exists via Graph before writing,
// so a stale picker selection can't silently save a broken config.
//
// SECURITY HARDENING (2026-09-22): now gated -- this let anyone re-point
// the connector at a different file inside the same authorized OneDrive
// account before.

const MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

async function getAccessToken(supabase: ReturnType<typeof createClient>): Promise<string> {
  const { data: oauth, error } = await supabase
    .from("excel_oauth")
    .select("id, client_id, client_secret, access_token, refresh_token, token_expires_at")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!oauth?.refresh_token) throw new Error("Excel not connected yet");

  let accessToken = oauth.access_token as string;
  const expiresAt = oauth.token_expires_at ? new Date(oauth.token_expires_at as string).getTime() : 0;
  if (!accessToken || expiresAt < Date.now() + 5 * 60 * 1000) {
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
    await supabase.from("excel_oauth").update({
      access_token: refreshJson.access_token,
      refresh_token: refreshJson.refresh_token ?? oauth.refresh_token,
      token_expires_at: new Date(Date.now() + (refreshJson.expires_in ?? 3600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", oauth.id);
  }
  return accessToken;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handlePreflight(req);
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST only" }), { status: 405, headers: corsHeaders(req) });
  }

  const auth = await requireAuthorizedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const fileId = String(body.fileId ?? "").trim();
    const fileName = String(body.fileName ?? "").trim();
    const tableName = String(body.tableName ?? "").trim();
    if (!fileId || !tableName) {
      return new Response(JSON.stringify({ ok: false, error: "fileId and tableName are required" }), {
        status: 400, headers: corsHeaders(req),
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const accessToken = await getAccessToken(supabase);

    const verifyRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(fileId)}/workbook/tables?$select=name`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!verifyRes.ok) {
      throw new Error(`Could not verify workbook (${verifyRes.status}): ${(await verifyRes.text()).slice(0, 300)}`);
    }
    const verifyJson = await verifyRes.json();
    const tableNames: string[] = (verifyJson.value ?? []).map((t: any) => t.name);
    if (!tableNames.includes(tableName)) {
      return new Response(
        JSON.stringify({ ok: false, error: `Table "${tableName}" was not found on that workbook anymore. Its tables now: ${tableNames.join(", ") || "(none)"}` }),
        { status: 409, headers: corsHeaders(req) },
      );
    }

    const { data: erpRow, error: erpReadError } = await supabase
      .from("erp_config")
      .select("id")
      .limit(1)
      .maybeSingle();
    if (erpReadError) throw erpReadError;
    if (!erpRow?.id) throw new Error("erp_config has no row to update");

    const { error: updateError } = await supabase
      .from("erp_config")
      .update({
        provider: "excel",
        excel_workbook_id: fileId,
        excel_workbook_path: fileName ? "/" + fileName : null,
        excel_table_name: tableName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", erpRow.id);
    if (updateError) throw updateError;

    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders(req) });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 502, headers: corsHeaders(req) });
  }
});
