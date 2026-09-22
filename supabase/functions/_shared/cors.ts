// Restricted CORS, shared by every function actually called from the
// dashboard's own browser JS. Replaces the old blanket
// Access-Control-Allow-Origin: "*" that every function used to send.
//
// Protocol-verified endpoints (whatsapp-webhook, excel-oauth-callback) do
// NOT use this -- CORS is a browser-enforced restriction on cross-origin
// *fetch()* calls; it does nothing for a server-to-server call (Meta,
// Microsoft) or a full-page browser navigation (the OAuth redirect), so
// applying it there would be a no-op at best and confusing at worst.
//
// Allowed origins come from the ALLOWED_ORIGINS secret (comma-separated),
// so local-dev origins can be added without a code change or redeploy.
// If that secret is unset, only the real production origin is allowed --
// never an accidental wildcard.
const DEFAULT_ALLOWED_ORIGINS = ["https://victoryacaman.github.io"];

function allowedOrigins(): string[] {
  const configured = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_ALLOWED_ORIGINS;
}

// Builds the header set for an actual (non-OPTIONS) response. If the
// request's Origin isn't on the allow-list, Access-Control-Allow-Origin
// is simply omitted -- the browser then blocks the calling page's JS from
// reading the response, even though the server still processed it (the
// real access control is the auth guard, not this).
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
  if (origin && allowedOrigins().includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "authorization, content-type, apikey, x-client-info";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
  }
  return headers;
}

export function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // no Origin header at all => not a browser cross-origin fetch (curl, server-to-server)
  return allowedOrigins().includes(origin);
}

// Preflight handling: an allowed origin gets a normal 204 with the CORS
// headers above; a disallowed one gets a 403 with no CORS headers at all,
// so the browser aborts before ever sending the real request.
export function handlePreflight(req: Request): Response {
  if (!isAllowedOrigin(req)) {
    return new Response("Origin not allowed", { status: 403 });
  }
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}
