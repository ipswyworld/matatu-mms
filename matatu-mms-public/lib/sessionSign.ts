/**
 * HMAC-SHA256 signing for the session cookie, using the Web Crypto API so the
 * same code runs in both the Node runtime (server actions, route handlers)
 * and the Edge runtime (middleware.ts) without adding a dependency.
 *
 * Cookie format: base64(payload) + "." + base64(hmac-signature)
 * On verify, a payload whose signature doesn't match is treated as absent —
 * the caller gets `null`, not the tampered data.
 */

const SECRET =
  process.env.SESSION_SECRET ||
  "dev-only-insecure-fallback-secret-change-in-production-2026";

let cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const encoder = new TextEncoder();
  cachedKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  return cachedKey;
}

function toBase64Url(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/").padEnd(str.length + ((4 - (str.length % 4)) % 4), "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export async function signPayload(payloadBase64: string): Promise<string> {
  const key = await getKey();
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadBase64));
  return `${payloadBase64}.${toBase64Url(signature)}`;
}

export async function verifyAndExtractPayload(signedValue: string): Promise<string | null> {
  const parts = signedValue.split(".");
  if (parts.length !== 2) return null;
  const [payloadBase64, signatureB64Url] = parts;

  const key = await getKey();
  const encoder = new TextEncoder();
  const expectedSignature = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadBase64));
  const providedSignature = fromBase64Url(signatureB64Url);

  const expectedBytes = new Uint8Array(expectedSignature);
  if (expectedBytes.length !== providedSignature.length) return null;

  // Constant-time comparison to avoid leaking timing information.
  let diff = 0;
  for (let i = 0; i < expectedBytes.length; i++) {
    diff |= expectedBytes[i] ^ providedSignature[i];
  }
  if (diff !== 0) return null;

  return payloadBase64;
}
