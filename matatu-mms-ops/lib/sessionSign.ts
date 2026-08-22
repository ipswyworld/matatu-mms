/**
 * HMAC-SHA256 signing for this app's own session cookie — deliberately a
 * separate secret (OPS_SESSION_SECRET) from the staff app's SESSION_SECRET,
 * so a compromise of one signing key doesn't also forge sessions in the
 * other. Same Web Crypto approach as matatu-mms/lib/sessionSign.ts (works
 * in both Node and the Edge middleware runtime).
 *
 * Cookie format: base64(payload) + "." + base64(hmac-signature)
 */

const SECRET =
  process.env.OPS_SESSION_SECRET ||
  "dev-only-insecure-ops-fallback-secret-change-in-production-2026";

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

  let diff = 0;
  for (let i = 0; i < expectedBytes.length; i++) {
    diff |= expectedBytes[i] ^ providedSignature[i];
  }
  if (diff !== 0) return null;

  return payloadBase64;
}
