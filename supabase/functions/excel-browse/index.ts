import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireAuthorizedUser } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";

// Lets an authorized user browse the connected OneDrive for the
// workbook/table picker (Add tools). Read-only, uses only the server-side
// stored token, never returns tokens.
//
// SECURITY HARDENING (2026-09-22): now gated -- this let anyone enumerate
// the connected OneDrive account's file/table names before.

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

  const auth = await requireAuthorizedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const accessToken = await getAccessToken(supabase);
    const headers = { Authorization: `Bearer ${accessToken}` };
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode");

    if (mode === "files") {
      const res = await fetch(
        "https://graph.microsoft.com/v1.0/me/drive/root/children?$select=id,name,file",
        { headers },
      );
      if (!res.ok) throw new Error(`OneDrive listing failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
      const json = await res.json();
      const files = (json.value ?? [])
        .filter((i: any) => i.file && /\.xlsx?$/i.test(i.name))
        .map((i: any) => ({ id: i.id, name: i.name }));
      return new Response(JSON.stringify({ ok: true, files }), { headers: corsHeaders(req) });
    }

    if (mode === "tables") {
      const fileId = url.searchParams.get("fileId");
      if (!fileId) throw new Error("fileId is required for mode=tables");
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(fileId)}/workbook/tables?$select=name`,
        { headers },
      );
      if (!res.ok) throw new Error(`Workbook tables read failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
      const json = await res.json();
      const tables = (json.value ?? []).map((t: any) => ({ name: t.name }));
      return new Response(JSON.stringify({ ok: true, tables }), { headers: corsHeaders(req) });
    }

    return new Response(JSON.stringify({ ok: false, error: "mode must be 'files' or 'tables'" }), {
      status: 400,
      headers: corsHeaders(req),
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 502,
      headers: corsHeaders(req),
    });
  }
});
