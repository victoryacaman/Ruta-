// Crypto helpers shared by every protected Edge Function: constant-time
// comparison, Meta webhook signature verification, and PKCE for the
// Microsoft OAuth flow. Pure functions -- no Supabase client, no env
// reads -- so these are directly unit-testable without a live project.

// Compares two byte arrays in constant time (no early return on the
// first mismatched byte), used for both the webhook signature check and
// the service-role-key comparison in auth.ts.
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function timingSafeStringEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) {
    // Still run a same-cost comparison so an attacker can't distinguish
    // "wrong length" from "right length, wrong bytes" by timing alone.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^sha256=/i, "");
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(clean)) {
    return new Uint8Array(0);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

// Verifies Meta's X-Hub-Signature-256 header against the EXACT raw
// request body bytes -- must be called with the untouched body text read
// via req.text(), before any JSON.parse, since the signature is computed
// over the raw bytes Meta sent, not a re-serialized object.
export async function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string | null | undefined,
): Promise<boolean> {
  if (!signatureHeader || !appSecret) return false;
  const provided = hexToBytes(signatureHeader);
  if (provided.length === 0) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return timingSafeEqual(new Uint8Array(mac), provided);
}

export function base64url(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(byteLength = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

// PKCE: code_verifier is a random string sent only between our own
// server-side functions (never to the browser); code_challenge is
// BASE64URL(SHA256(code_verifier)), sent to Microsoft up front.
export async function pkceChallengeFromVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}
