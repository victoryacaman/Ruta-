import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { corsHeaders, handlePreflight, isAllowedOrigin } from "../../supabase/functions/_shared/cors.ts";

function reqWithOrigin(origin: string | null, method = "GET"): Request {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  return new Request("https://example.test/fn", { method, headers });
}

// These tests rely on ALLOWED_ORIGINS being unset, so cors.ts falls back
// to its hardcoded DEFAULT_ALLOWED_ORIGINS (the real production origin).
// Explicitly cleared up front in case a prior test or the environment set it.
Deno.env.delete("ALLOWED_ORIGINS");

Deno.test("isAllowedOrigin: the real production origin is allowed", () => {
  assert(isAllowedOrigin(reqWithOrigin("https://victoryacaman.github.io")));
});

Deno.test("isAllowedOrigin: an arbitrary third-party origin is rejected", () => {
  assertFalse(isAllowedOrigin(reqWithOrigin("https://evil.example.com")));
});

Deno.test("isAllowedOrigin: no Origin header at all is treated as allowed (server-to-server, not a browser fetch)", () => {
  assert(isAllowedOrigin(reqWithOrigin(null)));
});

Deno.test("corsHeaders: allowed origin gets Access-Control-Allow-Origin echoed back", () => {
  const headers = corsHeaders(reqWithOrigin("https://victoryacaman.github.io"));
  assertEquals(headers["Access-Control-Allow-Origin"], "https://victoryacaman.github.io");
  assertEquals(headers["Vary"], "Origin");
});

Deno.test("corsHeaders: disallowed origin gets no Access-Control-Allow-Origin header at all", () => {
  const headers = corsHeaders(reqWithOrigin("https://evil.example.com"));
  assertEquals(headers["Access-Control-Allow-Origin"], undefined);
});

Deno.test("corsHeaders: never falls back to a wildcard for a disallowed origin", () => {
  const headers = corsHeaders(reqWithOrigin("https://evil.example.com"));
  assert(headers["Access-Control-Allow-Origin"] !== "*");
});

Deno.test("handlePreflight: allowed origin gets 204 with CORS headers", async () => {
  const res = handlePreflight(reqWithOrigin("https://victoryacaman.github.io", "OPTIONS"));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://victoryacaman.github.io");
});

Deno.test("handlePreflight: disallowed origin gets 403 with no CORS headers, so the browser aborts before the real request", async () => {
  const res = handlePreflight(reqWithOrigin("https://evil.example.com", "OPTIONS"));
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
});

Deno.test("ALLOWED_ORIGINS env var, when set, overrides the default allow-list", () => {
  Deno.env.set("ALLOWED_ORIGINS", "https://staging.example.com, https://victoryacaman.github.io");
  try {
    assert(isAllowedOrigin(reqWithOrigin("https://staging.example.com")));
    assert(isAllowedOrigin(reqWithOrigin("https://victoryacaman.github.io")));
    assertFalse(isAllowedOrigin(reqWithOrigin("https://not-listed.example.com")));
  } finally {
    Deno.env.delete("ALLOWED_ORIGINS");
  }
});
