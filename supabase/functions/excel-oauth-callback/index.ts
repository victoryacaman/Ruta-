import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Receives Microsoft's OAuth redirect, exchanges the code for tokens
// server-side (client_secret never touches the browser), stores them in
// the locked-down excel_oauth table, flips erp_config over to the excel
// provider (connecting should make it live immediately), and bounces the
// browser back to the dashboard with a plain status flag -- never a
// token, a PKCE verifier, or Microsoft's own error text.
//
// PUBLIC EXTERNAL CALLBACK, PROTOCOL-VERIFIED (2026-09-23): this is a
// full-page browser navigation Microsoft itself performs -- it can never
// carry a Supabase Authorization bearer token, so this is intentionally
// not gated by requireAuthorizedUser. Its real access control is the
// state parameter: excel-oauth-start only ever mints one for a session
// that already passed requireAuthorizedUser, and stores it server-side
// in oauth_states next to the PKCE code_verifier it generated for that
// same attempt. This function's whole job is validating that state
// exactly once (missing / unknown / expired / already-used / wrong
// provider all rejected the same way) before trusting anything else in
// the request, then completing the PKCE exchange with the verifier that
// only this backend ever saw.
const REDIRECT_URI =
  "https://gcrnarueiybbavmkzhcv.supabase.co/functions/v1/excel-oauth-callback";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const DASHBOARD_URL = "https://victoryacaman.github.io/Ruta-/ruta-dashboard-fixed.html";

// Generic-only: never interpolate a Microsoft error, a Postgres error, or
// any other provider/internal detail into the redirect. Real detail goes
// to console.error/warn server-side instead.
type ErrorCode =
  | "no_code"
  | "invalid_state"
  | "config_missing"
  | "token_exchange_failed"
  | "server_error";

function toDashboard(status: "connected" | "error", code?: ErrorCode) {
  const url = new URL(DASHBOARD_URL);
  url.searchParams.set("excel", status);
  if (code) url.searchParams.set("excel_msg", code);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const state = url.searchParams.get("state");

  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    console.warn(`excel-oauth-callback: Microsoft returned an error: ${oauthError} - ${url.searchParams.get("error_description") ?? ""}`);
    return toDashboard("error", "token_exchange_failed");
  }

  const code = url.searchParams.get("code");
  if (!code) return toDashboard("error", "no_code");

  if (!state) {
    console.warn("excel-oauth-callback: no state parameter on the redirect");
    return toDashboard("error", "invalid_state");
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Atomic, single-use consume: this UPDATE only matches a row that is
    // still unused and unexpired, so two requests racing on the same
    // state (a replay, or Microsoft/the browser firing the redirect
    // twice) can only ever have one of them succeed -- the second finds
    // zero matching rows because used_at is already set.
    const { data: stateRow, error: stateError } = await supabase
      .from("oauth_states")
      .update({ used_at: new Date().toISOString() })
      .eq("state", state)
      .eq("provider", "microsoft")
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("code_verifier, user_id")
      .maybeSingle();
    if (stateError) throw stateError;
    if (!stateRow) {
      console.warn(`excel-oauth-callback: state rejected (missing, unknown, expired, reused, or wrong provider): ${state.slice(0, 8)}...`);
      return toDashboard("error", "invalid_state");
    }

    const { data: oauthRow, error: oauthReadError } = await supabase
      .from("excel_oauth")
      .select("id, client_id, client_secret")
      .limit(1)
      .maybeSingle();
    if (oauthReadError) throw oauthReadError;
    if (!oauthRow?.client_id || !oauthRow?.client_secret) {
      return toDashboard("error", "config_missing");
    }

    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: oauthRow.client_id,
        client_secret: oauthRow.client_secret,
        code,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
        code_verifier: stateRow.code_verifier,
      }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok || !tokenJson.access_token) {
      console.error(`excel-oauth-callback: token exchange failed (user ${stateRow.user_id}): ${tokenRes.status} ${JSON.stringify(tokenJson)}`);
      return toDashboard("error", "token_exchange_failed");
    }

    const meRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    const meJson = meRes.ok ? await meRes.json() : {};
    const email: string | null = meJson.mail ?? meJson.userPrincipalName ?? null;

    const expiresAt = new Date(Date.now() + (tokenJson.expires_in ?? 3600) * 1000).toISOString();
    const { error: updateError } = await supabase
      .from("excel_oauth")
      .update({
        access_token: tokenJson.access_token,
        refresh_token: tokenJson.refresh_token ?? null,
        token_expires_at: expiresAt,
        connected_account_email: email,
        updated_at: new Date().toISOString(),
      })
      .eq("id", oauthRow.id);
    if (updateError) throw updateError;

    const { data: erpRow, error: erpReadError } = await supabase
      .from("erp_config")
      .select("id")
      .limit(1)
      .maybeSingle();
    if (erpReadError) throw erpReadError;
    if (erpRow?.id) {
      const { error: erpUpdateError } = await supabase
        .from("erp_config")
        .update({ provider: "excel", updated_at: new Date().toISOString() })
        .eq("id", erpRow.id);
      if (erpUpdateError) throw erpUpdateError;
    }

    console.log(`excel-oauth-callback: connected for user ${stateRow.user_id}`);
    return toDashboard("connected");
  } catch (err) {
    console.error("excel-oauth-callback error:", err);
    return toDashboard("error", "server_error");
  }
});
