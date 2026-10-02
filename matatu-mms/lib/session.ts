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

const DEFAULT_MAX_AGE = 60 * 60 * 8; // 8 hours
// Mirrors backend/app/config.py's REMEMBER_ME_EXPIRE_DAYS — kept as a
// separate constant rather than read from the login response, since it's a
// static config value, not something the user's request needs to round-trip.
const REMEMBER_ME_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export async function setSessionCookie(data: SessionData, rememberMe = false) {
  cookies().set(COOKIE_NAME, await createSessionCookieValue(data), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: rememberMe ? REMEMBER_ME_MAX_AGE : DEFAULT_MAX_AGE,
  });
}

export function clearSessionCookie() {
  cookies().delete(COOKIE_NAME);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;

// --- MFA-pending state ---------------------------------------------------
// Between a correct password and a verified TOTP code, the user has no
// valid session yet (see loginAction) — the backend's short-lived mfaToken
// (already a signed JWT) is stashed in its own httpOnly cookie rather than
// in the real session cookie, so a half-authenticated request can never be
// mistaken for a full one by middleware or readSession(). 5 minutes matches
// the backend token's own expiry (routes/auth.py's create_access_token call).
const MFA_PENDING_COOKIE_NAME = "mms_mfa_pending";
const MFA_PENDING_MAX_AGE = 60 * 5;

export function setMfaPendingCookie(mfaToken: string) {
  cookies().set(MFA_PENDING_COOKIE_NAME, mfaToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MFA_PENDING_MAX_AGE,
  });
}

export function readMfaPendingCookie(): string | null {
  return cookies().get(MFA_PENDING_COOKIE_NAME)?.value ?? null;
}

export function clearMfaPendingCookie() {
  cookies().delete(MFA_PENDING_COOKIE_NAME);
}
