import { NextRequest, NextResponse } from "next/server";
import { verifyAndExtractPayload } from "./lib/sessionSign";

const SESSION_COOKIE_NAME = "mms_session";

// This is the staff app (county government back-office). Passenger, Crew,
// and Sacco Operator roles sign in through a completely separate app/
// deployment and never reach this middleware — /login is this app's real
// front door; "/" just redirects there (see app/page.tsx).
// /mfa/verify is reachable pre-session (it reads its own short-lived
// mms_mfa_pending cookie, not mms_session) — /mfa/setup is deliberately NOT
// here since it requires a real (if MFA-incomplete) session; see the gate
// below.
const PUBLIC_PATHS = ["/login", "/faq", "/terms", "/contact", "/forgot-password", "/reset-password", "/mfa/verify"];

const ENFORCEMENT_ROLES = ["ENFORCEMENT", "ARRESTING_OFFICER", "RELEASING_OFFICER", "ENFORCEMENT_COMMANDER"];
const ADMIN_TIER_ROLES = ["ADMIN", "SUPERADMIN"];

// Single source of truth for "where does this role land by default".
function homeForRole(role: string): string {
  if (role === "DIRECTOR_MOBILITY" || role === "CHIEF_OFFICER") return "/saccos/verify";
  if (ENFORCEMENT_ROLES.includes(role)) return "/enforcement";
  return "/dashboard";
}

/**
 * Verifies the HMAC signature before trusting anything in the cookie. A
 * tampered/forged cookie (e.g. someone hand-crafting a base64 JSON blob with
 * role:"ADMIN") fails verification here and is redirected to /login exactly
 * like having no session at all — this is the actual security boundary;
 * lib/session.ts's readSession() trusts that requests reaching a page have
 * already passed through here.
 */
async function readVerifiedSession(request: NextRequest): Promise<{ role: string; mfaSetupRequired: boolean } | null> {
  const raw = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) return null;
  const payloadBase64 = await verifyAndExtractPayload(raw);
  if (!payloadBase64) return null;
  try {
    const json = Buffer.from(payloadBase64, "base64").toString("utf-8");
    const parsed = JSON.parse(json);
    const role = parsed.role as string;
    if (!role) return null;
    return { role, mfaSetupRequired: !!parsed.mfaSetupRequired };
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Next.js internals + any static file in /public (identified by file extension)
  if (
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    /\.(png|jpg|jpeg|svg|webp|gif|ico|css|js|txt|xml|woff2?|ttf)$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  const session = await readVerifiedSession(request);

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (!session) {
    const loginUrl = new URL("/login", request.url);
    const response = NextResponse.redirect(loginUrl);
    // Clear a tampered/invalid cookie outright rather than leaving it to be re-checked forever.
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }

  const { role } = session;

  // MFA is opt-in, not enforced — /mfa/setup stays reachable for anyone who
  // wants to turn it on voluntarily, but no role is confined there.

  // Director of Mobility / Chief Officer: confined to the Operator
  // Verification hub (and their dashboard) — they don't need the full
  // admin console to do their two-stage approval job.
  if ((role === "DIRECTOR_MOBILITY" || role === "CHIEF_OFFICER") && !pathname.startsWith("/saccos/verify") && !pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/saccos/verify", request.url));
  }

  // Admin-tier-only system management pages
  if (pathname.startsWith("/users") && !ADMIN_TIER_ROLES.includes(role)) {
    return NextResponse.redirect(new URL(homeForRole(role), request.url));
  }
  if (pathname.startsWith("/audit-logs") && !ADMIN_TIER_ROLES.includes(role)) {
    return NextResponse.redirect(new URL(homeForRole(role), request.url));
  }
  if (pathname.startsWith("/saccos/verify") && ![...ADMIN_TIER_ROLES, "DIRECTOR_MOBILITY", "CHIEF_OFFICER"].includes(role)) {
    return NextResponse.redirect(new URL(homeForRole(role), request.url));
  }
  // Super Admin-only console: system health, config, admin-account management
  if (pathname.startsWith("/system") && role !== "SUPERADMIN") {
    return NextResponse.redirect(new URL(homeForRole(role), request.url));
  }

  // Enforcement-family roles land and stay on their own Overview — /dashboard
  // is the Admin/Viewer landing page and isn't in their sidebar at all, which
  // was the original bug (login dropped them on a page with no way back to it).
  if (ENFORCEMENT_ROLES.includes(role) && pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/enforcement", request.url));
  }

  // Filing a scene report is an Arresting Officer (or Commander/Admin) action
  if (pathname.startsWith("/enforcement/scene") && !["ADMIN", "ENFORCEMENT_COMMANDER", "ARRESTING_OFFICER"].includes(role)) {
    return NextResponse.redirect(new URL("/enforcement", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
