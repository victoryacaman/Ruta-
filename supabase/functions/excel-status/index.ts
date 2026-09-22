import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireAuthorizedUser } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";

// Read-only status check for the dashboard's Excel/OneDrive card. Never
// returns tokens or the client_secret.
//
// SECURITY HARDENING (2026-09-22): now gated -- this returned the
// connected Microsoft account's real email address to any anonymous
// caller before.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handlePreflight(req);

  const auth = await requireAuthorizedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await supabase
      .from("excel_oauth")
      .select("refresh_token, connected_account_email")
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    return new Response(
      JSON.stringify({
        ok: true,
        connected: Boolean(data?.refresh_token),
        email: data?.connected_account_email ?? null,
      }),
      { headers: corsHeaders(req) },
    );
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 502,
      headers: corsHeaders(req),
    });
  }
});
