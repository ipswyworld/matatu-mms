import { cookies } from "next/headers";
import { OpsSessionData } from "./types";
import { signPayload, verifyAndExtractPayload } from "./sessionSign";

const COOKIE_NAME = "mms_ops_session";
export const SESSION_COOKIE_NAME = COOKIE_NAME;

// Deliberately its own cookie, own name, own secret (OPS_SESSION_SECRET) —
// separate from the staff app's mms_session. A SUPERADMIN signs into this
// console the same way they sign into the staff app (same backend
// credentials, same MFA), but the two sessions are independent: this app
// can be process-isolated from a crash in the main staff app (the whole
// point of Option B) without also sharing its session-signing key.

const MFA_PENDING_COOKIE_NAME = "mms_ops_mfa_pending";
const MFA_PENDING_MAX_AGE = 60 * 5;
const SESSION_MAX_AGE = 60 * 60 * 8; // 8 hours — this console is used rarely and briefly

export async function setSessionCookie(data: OpsSessionData) {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64");
  cookies().set(COOKIE_NAME, await signPayload(payload), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export function readSession(): OpsSessionData | null {
  const raw = cookies().get(COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    const [payloadBase64] = raw.split(".");
    if (!payloadBase64) return null;
    return JSON.parse(Buffer.from(payloadBase64, "base64").toString("utf-8")) as OpsSessionData;
  } catch {
    return null;
  }
}

export function clearSessionCookie() {
  cookies().delete(COOKIE_NAME);
}

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

export { verifyAndExtractPayload };
