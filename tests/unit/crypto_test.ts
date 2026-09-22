import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  base64url,
  pkceChallengeFromVerifier,
  randomToken,
  timingSafeEqual,
  timingSafeStringEqual,
  verifyMetaSignature,
} from "../../supabase/functions/_shared/crypto.ts";

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- verifyMetaSignature: the whatsapp-webhook gate ---

Deno.test("verifyMetaSignature accepts a correctly-signed body", async () => {
  const secret = "test-app-secret";
  const body = JSON.stringify({ entry: [{ id: "1" }] });
  const sig = "sha256=" + (await hmacSha256Hex(secret, body));
  assert(await verifyMetaSignature(body, sig, secret));
});

Deno.test("verifyMetaSignature rejects a signature computed with the wrong secret", async () => {
  const body = JSON.stringify({ entry: [{ id: "1" }] });
  const sig = "sha256=" + (await hmacSha256Hex("wrong-secret", body));
  assertFalse(await verifyMetaSignature(body, sig, "test-app-secret"));
});

Deno.test("verifyMetaSignature rejects a signature computed over a different body (tampered payload)", async () => {
  const secret = "test-app-secret";
  const originalBody = JSON.stringify({ entry: [{ id: "1" }] });
  const sig = "sha256=" + (await hmacSha256Hex(secret, originalBody));
  const tamperedBody = JSON.stringify({ entry: [{ id: "2" }] });
  assertFalse(await verifyMetaSignature(tamperedBody, sig, secret));
});

Deno.test("verifyMetaSignature rejects a missing signature header", async () => {
  assertFalse(await verifyMetaSignature("{}", null, "test-app-secret"));
});

Deno.test("verifyMetaSignature rejects when the app secret isn't configured", async () => {
  const body = "{}";
  const sig = "sha256=" + (await hmacSha256Hex("some-secret", body));
  assertFalse(await verifyMetaSignature(body, sig, null));
  assertFalse(await verifyMetaSignature(body, sig, undefined));
});

Deno.test("verifyMetaSignature rejects a malformed (non-hex) signature header", async () => {
  assertFalse(await verifyMetaSignature("{}", "sha256=not-hex-at-all!!", "test-app-secret"));
});

Deno.test("verifyMetaSignature rejects an empty-string secret the same as a missing one", async () => {
  assertFalse(await verifyMetaSignature("{}", "sha256=aa", ""));
});

// --- timing-safe comparisons ---

Deno.test("timingSafeStringEqual: equal strings compare equal", () => {
  assert(timingSafeStringEqual("abc123", "abc123"));
});

Deno.test("timingSafeStringEqual: different strings of the same length compare unequal", () => {
  assertFalse(timingSafeStringEqual("abc123", "abc124"));
});

Deno.test("timingSafeStringEqual: different lengths compare unequal without throwing", () => {
  assertFalse(timingSafeStringEqual("short", "a-much-longer-string"));
});

Deno.test("timingSafeEqual: byte arrays of different length are unequal", () => {
  assertFalse(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2])));
});

// --- PKCE (excel-oauth-start / excel-oauth-callback) ---

Deno.test("pkceChallengeFromVerifier is deterministic for the same verifier", async () => {
  const verifier = "a-fixed-test-verifier-value-1234567890";
  const a = await pkceChallengeFromVerifier(verifier);
  const b = await pkceChallengeFromVerifier(verifier);
  assertEquals(a, b);
});

Deno.test("pkceChallengeFromVerifier changes when the verifier changes", async () => {
  const a = await pkceChallengeFromVerifier("verifier-one");
  const b = await pkceChallengeFromVerifier("verifier-two");
  assert(a !== b);
});

Deno.test("pkceChallengeFromVerifier produces a base64url string (no +, /, or = padding)", async () => {
  const challenge = await pkceChallengeFromVerifier("some-verifier-value");
  assertFalse(/[+/=]/.test(challenge));
});

Deno.test("pkceChallengeFromVerifier matches a known SHA-256 test vector", async () => {
  // RFC 7636 Appendix B's own worked example.
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = await pkceChallengeFromVerifier(verifier);
  assertEquals(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

// --- randomToken / base64url (oauth_states.state, code_verifier) ---

Deno.test("randomToken produces different values on each call", () => {
  const a = randomToken(32);
  const b = randomToken(32);
  assert(a !== b);
});

Deno.test("randomToken output is URL-safe (no +, /, or = padding)", () => {
  const token = randomToken(32);
  assertFalse(/[+/=]/.test(token));
});

Deno.test("randomToken(48) is long enough to satisfy Microsoft's PKCE 43-128 char requirement", () => {
  const token = randomToken(48);
  assert(token.length >= 43 && token.length <= 128);
});

Deno.test("base64url encodes without padding or reserved characters", () => {
  const encoded = base64url(new Uint8Array([251, 255, 254]));
  assertFalse(/[+/=]/.test(encoded));
});
