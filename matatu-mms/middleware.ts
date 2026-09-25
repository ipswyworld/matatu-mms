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
// /impersonate/consume is reachable pre-session for the same reason
// /mfa/verify is — it's the landing point for a ticket-based handoff (from
// the ops console's "Impersonate" action) that establishes the session
// itself; there's no cookie to check yet when the browser first arrives.
// /impersonate/error is where that handler redirects on failure.
const PUBLIC_PATHS = ["/login", "/faq", "/terms", "/contact", "/forgot-password", "/reset-password", "/mfa/verify", "/impersonate/consume", "/impersonate/error"];

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
async function readVerifiedSession(request: NextRequest): Promise<{ role: string; additionalRoles: string[]; mfaSetupRequired: boolean } | null> {
  const raw = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) return null;
  const payloadBase64 = await verifyAndExtractPayload(raw);
  if (!payloadBase64) return null;
  try {
    const json = Buffer.from(payloadBase64, "base64").toString("utf-8");
    const parsed = JSON.parse(json);
    const role = parsed.role as string;
    if (!role) return null;
    const additionalRoles = Array.isArray(parsed.additionalRoles) ? (parsed.additionalRoles as string[]) : [];
    return { role, additionalRoles, mfaSetupRequired: !!parsed.mfaSetupRequired };
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Next.js internals + any static file in /public (identified by file extension)
  //
  // `webmanifest` was missing here too (see the public app's middleware for
  // the exact failure mode this causes: a silent, unnoticed PWA-install
  // break) — added along with the new manifest.webmanifest this app now has.
  if (
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    // Next's generated metadata-file routes (app/opengraph-image.tsx etc.)
    // serve at this exact path with no file extension, so the regex below
    // never matches it — confirmed live: it 307-redirected to /login before
    // this explicit exemption was added.
    pathname === "/opengraph-image" ||
    /\.(png|jpg|jpeg|svg|webp|gif|ico|css|js|txt|xml|json|webmanifest|woff2?|ttf)$/i.test(pathname)
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

  const { role, additionalRoles, mfaSetupRequired } = session;
  // Every gate below checks the full effective role set (primary + any
  // additional predefined roles a Super Admin has granted), not just the
  // primary role, so e.g. an additional ADMIN role actually unlocks /users.
  const roles = [role, ...additionalRoles];
  const hasAdminTier = roles.some((r) => ADMIN_TIER_ROLES.includes(r));

  // MFA is enforced for admin-tier accounts: auth.py sets mfaSetupRequired
  // on login for any ADMIN/SUPERADMIN that hasn't completed enrollment yet,
  // and confirmMfaAction clears it the moment they do (lib/actions.ts) — so
  // this redirect only ever fires for the genuine "never enrolled" window,
  // never for an already-enrolled admin or any non-admin-tier role.
  if (hasAdminTier && mfaSetupRequired && !pathname.startsWith("/mfa")) {
    return NextResponse.redirect(new URL("/mfa/setup", request.url));
  }

  // Director of Mobility / Chief Officer: confined to the Operator
  // Verification hub (and their dashboard) — they don't need the full
  // admin console to do their two-stage approval job. An admin-tier
  // additional role lifts this confinement (see homeForRole/dashboard's
  // matching "admin-tier wins" rule).
  if (!hasAdminTier && (role === "DIRECTOR_MOBILITY" || role === "CHIEF_OFFICER") && !pathname.startsWith("/saccos/verify") && !pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/saccos/verify", request.url));
  }

  // Admin-tier-only system management pages
  if (pathname.startsWith("/users") && !hasAdminTier) {
    return NextResponse.redirect(new URL(homeForRole(role), request.url));
  }
  if (pathname.startsWith("/audit-logs") && !hasAdminTier) {
    return NextResponse.redirect(new URL(homeForRole(role), request.url));
  }
  if (pathname.startsWith("/saccos/verify") && !hasAdminTier && !roles.includes("DIRECTOR_MOBILITY") && !roles.includes("CHIEF_OFFICER")) {
    return NextResponse.redirect(new URL(homeForRole(role), request.url));
  }
  // Super Admin-only console: system health, config, admin-account management
  if (pathname.startsWith("/system") && !roles.includes("SUPERADMIN")) {
    return NextResponse.redirect(new URL(homeForRole(role), request.url));
  }

  // Enforcement-family roles land and stay on their own Overview — /dashboard
  // is the Admin/Viewer landing page and isn't in their sidebar at all, which
  // was the original bug (login dropped them on a page with no way back to it).
  if (!hasAdminTier && ENFORCEMENT_ROLES.includes(role) && pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/enforcement", request.url));
  }

  // Filing a scene report is an Arresting Officer (or Commander/Admin) action
  if (pathname.startsWith("/enforcement/scene") && !roles.some((r) => ["ADMIN", "ENFORCEMENT_COMMANDER", "ARRESTING_OFFICER"].includes(r))) {
    return NextResponse.redirect(new URL("/enforcement", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
