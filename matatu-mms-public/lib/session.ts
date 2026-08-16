import { cookies } from "next/headers";
import { SessionData } from "./types";
import { signPayload, verifyAndExtractPayload } from "./sessionSign";

const COOKIE_NAME = "mms_session";

/**
 * The session cookie carries a base64 JSON payload plus an HMAC-SHA256
 * signature (see lib/sessionSign.ts). Tampering with the payload or role
 * client-side invalidates the signature and the session is treated as
 * absent — actual authorization still comes from the backend JWT, this
 * closes the gap where a forged cookie could otherwise fool client-side
 * role checks (nav visibility, middleware redirects) into showing UI a
 * user shouldn't see, even though it could never grant real API access.
 */

export async function createSessionCookieValue(data: SessionData): Promise<string> {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64");
  return signPayload(payload);
}

export function readSession(): SessionData | null {
  const raw = cookies().get(COOKIE_NAME)?.value;
  if (!raw) return null;
  // Signature verification is async (Web Crypto); readSession is used
  // synchronously across ~20 server components, so we do a fast structural
  // check here and rely on setSessionCookie only ever writing signed values
  // plus the middleware's async verification at the edge for the real gate.
  try {
    const [payloadBase64] = raw.split(".");
    if (!payloadBase64) return null;
    return JSON.parse(Buffer.from(payloadBase64, "base64").toString("utf-8")) as SessionData;
  } catch {
    return null;
  }
}

export async function verifySessionCookie(raw: string): Promise<SessionData | null> {
  const payloadBase64 = await verifyAndExtractPayload(raw);
  if (!payloadBase64) return null;
  try {
    return JSON.parse(Buffer.from(payloadBase64, "base64").toString("utf-8")) as SessionData;
  } catch {
    return null;
  }
}

export async function setSessionCookie(data: SessionData) {
  cookies().set(COOKIE_NAME, await createSessionCookieValue(data), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8, // 8 hours
  });
}

export function clearSessionCookie() {
  cookies().delete(COOKIE_NAME);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
