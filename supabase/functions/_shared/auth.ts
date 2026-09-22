// Shared authorization guard for every protected Edge Function in this
// project. Call requireAuthorizedUser(req) first thing, before touching
// any request body or doing any real work; if result.ok is false, return
// result.response immediately.
//
// Two ways to pass:
// 1. The bearer token IS this project's own SUPABASE_SERVICE_ROLE_KEY --
//    a trusted internal call from one of this project's own Edge
//    Functions (e.g. risk-recommendation calling erp-inventory). Not a
//    new secret: every Edge Function already has this key in its own
//    environment, so this reuses the existing stack rather than
//    inventing an internal token.
// 2. The bearer token is a real Supabase Auth user JWT, verified via
//    Supabase Auth, AND that user's email is present in
//    pilot_authorized_emails. A valid session alone is not enough --
//    both checks must pass.
//
// Never logs a full token or the service_role key -- only a short
// fingerprint and, on failure, the reason.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { timingSafeStringEqual } from "./crypto.ts";
import { corsHeaders } from "./cors.ts";

export interface AuthUser {
  id: string;
  email: string;
}

export type AuthResult =
  | { ok: true; user: AuthUser | null; isServiceRole: boolean }
  | { ok: false; response: Response };

function fingerprint(token: string): string {
  if (token.length <= 8) return "(token too short to fingerprint)";
  return `${token.slice(0, 4)}…${token.slice(-4)} (${token.length} chars)`;
}

function jsonError(req: Request, status: 401 | 403, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: corsHeaders(req),
  });
}

export async function requireAuthorizedUser(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    console.warn("auth: request had no bearer token");
    return { ok: false, response: jsonError(req, 401, "Missing Authorization bearer token") };
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (serviceRoleKey && timingSafeStringEqual(token, serviceRoleKey)) {
    return { ok: true, user: null, isServiceRole: true };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) {
    console.error("auth: SUPABASE_URL not configured");
    return { ok: false, response: jsonError(req, 401, "Server misconfigured") };
  }

  // A plain, unprivileged client whose only job is to ask Supabase Auth
  // "whose token is this" -- getUser() verifies the JWT signature/expiry
  // against Supabase Auth itself, it does not trust the token's claims
  // blindly.
  const authClient = createClient(supabaseUrl, serviceRoleKey || token);
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data?.user?.email) {
    console.warn(`auth: token verification failed for ${fingerprint(token)}: ${error?.message ?? "no user on token"}`);
    return { ok: false, response: jsonError(req, 401, "Invalid or expired session") };
  }

  const email = data.user.email.toLowerCase();

  if (!serviceRoleKey) {
    console.error("auth: SUPABASE_SERVICE_ROLE_KEY not configured, cannot check allowlist");
    return { ok: false, response: jsonError(req, 401, "Server misconfigured") };
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: allowRow, error: allowError } = await admin
    .from("pilot_authorized_emails")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  if (allowError) {
    console.error("auth: allowlist lookup failed:", allowError.message);
    return { ok: false, response: jsonError(req, 401, "Could not verify authorization") };
  }
  if (!allowRow) {
    console.warn(`auth: authenticated user ${data.user.id} is not on the pilot allowlist`);
    return { ok: false, response: jsonError(req, 403, "Your account is not authorized for this Utopia deployment") };
  }

  return { ok: true, user: { id: data.user.id, email }, isServiceRole: false };
}
