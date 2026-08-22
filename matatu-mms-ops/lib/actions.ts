"use server";

import { redirect } from "next/navigation";
import {
  setSessionCookie, clearSessionCookie,
  setMfaPendingCookie, readMfaPendingCookie, clearMfaPendingCookie,
} from "./session";

// Same backend as the staff app — this console doesn't have its own user
// accounts, it authenticates against the same SUPERADMIN accounts and
// simply refuses anyone whose role isn't SUPERADMIN, checked here (not
// just hidden in the UI) since the backend itself has no concept of "this
// request came from the ops console."
const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

export async function loginAction(_prevState: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });

    if (!res.ok) {
      if (res.status === 401) return { error: "Invalid email or password." };
      if (res.status === 429) return { error: "Too many sign-in attempts. Please wait a minute and try again." };
      return { error: `Sign-in failed (${res.status}). Please try again.` };
    }

    const data = await res.json();

    if (data.mfaRequired) {
      setMfaPendingCookie(data.mfaToken);
      redirect("/mfa-verify");
    }

    if (data.user.role !== "SUPERADMIN") {
      return { error: "This console is for Superadmin accounts only." };
    }

    // MFA is opt-in, not required, to reach this console — a Superadmin who
    // hasn't enrolled just signs straight in. Anyone who does enable MFA
    // (via the staff app) still goes through the mfaRequired branch above
    // on their next login, same as any other account.
    await setSessionCookie({ userId: data.user.id, name: data.user.name, role: "SUPERADMIN", token: data.accessToken });
    redirect("/");
  } catch (err: any) {
    if (err.digest?.startsWith("NEXT_REDIRECT")) throw err;
    return { error: "Could not reach the authentication server. Please check your connection and try again." };
  }
}

export async function verifyMfaAction(_prevState: { error?: string } | undefined, formData: FormData) {
  const code = String(formData.get("code") || "").trim();
  const mfaToken = readMfaPendingCookie();

  if (!mfaToken) {
    return { error: "This sign-in attempt has expired. Please sign in again." };
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/verify-mfa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mfaToken, code }),
      cache: "no-store",
    });

    if (!res.ok) {
      if (res.status === 401) return { error: "That code is incorrect. Please try again." };
      return { error: `Verification failed (${res.status}). Please try again.` };
    }

    const data = await res.json();
    clearMfaPendingCookie();

    if (data.user.role !== "SUPERADMIN") {
      return { error: "This console is for Superadmin accounts only." };
    }

    await setSessionCookie({ userId: data.user.id, name: data.user.name, role: "SUPERADMIN", token: data.accessToken });
    redirect("/");
  } catch (err: any) {
    if (err.digest?.startsWith("NEXT_REDIRECT")) throw err;
    return { error: "Could not reach the authentication server. Please check your connection and try again." };
  }
}

export async function logoutAction() {
  clearSessionCookie();
  redirect("/login");
}
