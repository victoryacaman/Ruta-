import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireAuthorizedUser } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { pkceChallengeFromVerifier, randomToken } from "../_shared/crypto.ts";

// Kicks off the Microsoft OAuth flow for the Excel/OneDrive ERP
// connector. client_secret never leaves excel_oauth; this only ever
// reads the non-secret client_id.
//
// SECURITY HARDENING (2026-09-22/23):
// - now requires an authorized Utopia session to even generate a state
//   -- an arbitrary visitor can no longer kick off a connection attempt
//   that could later replace the one, single, global OneDrive account
//   every other user of this dashboard reads from.
// - because a plain <a href> navigation can't carry an Authorization
//   header, this no longer 302-redirects itself. It returns the
//   Microsoft authorize URL as JSON; the dashboard calls this via an
//   authenticated fetch, then navigates the browser to the URL it gets
//   back. See ruta-dashboard-fixed.html's connectExcel().
// - real state + PKCE: a cryptographically random state and a PKCE
//   code_verifier/code_challenge pair are generated per attempt and
//   stored server-side in oauth_states (state, the requesting user's id,
//   the verifier, an expiry, a used-once flag) -- not just generated and
//   handed to Microsoft with nothing kept to check it against later,
//   which is what this function did before. excel-oauth-callback
//   validates and consumes this row exactly once.

const REDIRECT_URI = "https://gcrnarueiybbavmkzhcv.supabase.co/functions/v1/excel-oauth-callback";
// /common supports both personal Microsoft accounts and work/school
// (Microsoft 365) accounts signing into the same app registration.
const AUTHORIZE_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const SCOPE = "Files.Read offline_access User.Read";
const STATE_TTL_MINUTES = 15;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handlePreflight(req);

  const auth = await requireAuthorizedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: config, error } = await supabase
      .from("excel_oauth")
      .select("client_id")
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!config?.client_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "Excel connector isn't configured yet — no Azure client_id stored. Ask your Utopia contact to finish setup." }),
        { status: 503, headers: corsHeaders(req) },
      );
    }

    const state = randomToken(32);
    const codeVerifier = randomToken(48); // 64 base64url chars, well within Microsoft's 43-128 requirement
    const codeChallenge = await pkceChallengeFromVerifier(codeVerifier);
    const expiresAt = new Date(Date.now() + STATE_TTL_MINUTES * 60_000).toISOString();

    const { error: insertError } = await supabase.from("oauth_states").insert({
      state, provider: "microsoft", user_id: auth.user.id, code_verifier: codeVerifier, expires_at: expiresAt,
    });
    if (insertError) throw insertError;

    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("client_id", config.client_id);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", REDIRECT_URI);
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("scope", SCOPE);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");

    return new Response(JSON.stringify({ ok: true, authorizeUrl: url.toString() }), { headers: corsHeaders(req) });
  } catch (err) {
    console.error("excel-oauth-start error:", err);
    return new Response(JSON.stringify({ ok: false, error: "Could not start the Excel connection. Please try again." }), {
      status: 500,
      headers: corsHeaders(req),
    });
  }
});
