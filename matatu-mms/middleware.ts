import { NextRequest, NextResponse } from "next/server";
import { verifyAndExtractPayload } from "./lib/sessionSign";

const SESSION_COOKIE_NAME = "mms_session";
const PUBLIC_PATHS = ["/login", "/register", "/faq", "/terms", "/operator-onboarding", "/pay-fine", "/contact", "/forgot-password", "/reset-password"];

/**
 * Verifies the HMAC signature before trusting anything in the cookie. A
 * tampered/forged cookie (e.g. someone hand-crafting a base64 JSON blob with
 * role:"ADMIN") fails verification here and is redirected to /login exactly
 * like having no session at all — this is the actual security boundary;
 * lib/session.ts's readSession() trusts that requests reaching a page have
 * already passed through here.
 */
async function readVerifiedRole(request: NextRequest): Promise<string | null> {
  const raw = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) return null;
  const payloadBase64 = await verifyAndExtractPayload(raw);
  if (!payloadBase64) return null;
  try {
    const json = Buffer.from(payloadBase64, "base64").toString("utf-8");
    return (JSON.parse(json).role as string) ?? null;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public paths + Next.js internals + any static file in /public (identified by file extension)
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    /\.(png|jpg|jpeg|svg|webp|gif|ico|css|js|txt|xml|woff2?|ttf)$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  const role = await readVerifiedRole(request);

  if (!role) {
    const loginUrl = new URL("/login", request.url);
    const response = NextResponse.redirect(loginUrl);
    // Clear a tampered/invalid cookie outright rather than leaving it to be re-checked forever.
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }

  // Strict PASSENGER portal restriction: Passengers can ONLY access /passenger-portal
  if (role === "PASSENGER" && !pathname.startsWith("/passenger-portal")) {
    return NextResponse.redirect(new URL("/passenger-portal", request.url));
  }

  // Strict CREW portal restriction: Crew members can ONLY access /crew-portal
  if (role === "CREW" && !pathname.startsWith("/crew-portal")) {
    return NextResponse.redirect(new URL("/crew-portal", request.url));
  }

  // Director of Mobility / Chief Officer: confined to the Operator
  // Verification hub (and their dashboard) — they don't need the full
  // admin console to do their two-stage approval job.
  if ((role === "DIRECTOR_MOBILITY" || role === "CHIEF_OFFICER") && !pathname.startsWith("/saccos/verify") && !pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/saccos/verify", request.url));
  }

  const ENFORCEMENT_ROLES = ["ENFORCEMENT", "ARRESTING_OFFICER", "RELEASING_OFFICER", "ENFORCEMENT_COMMANDER"];
  const defaultHomeFor = (r: string) =>
    r === "SACCO_OPERATOR" ? "/sacco-portal" : ENFORCEMENT_ROLES.includes(r) ? "/enforcement" : "/dashboard";

  const ADMIN_TIER_ROLES = ["ADMIN", "SUPERADMIN"];

  // Admin-tier-only system management pages
  if (pathname.startsWith("/users") && !ADMIN_TIER_ROLES.includes(role)) {
    return NextResponse.redirect(new URL(defaultHomeFor(role), request.url));
  }
  if (pathname.startsWith("/audit-logs") && !ADMIN_TIER_ROLES.includes(role)) {
    return NextResponse.redirect(new URL(defaultHomeFor(role), request.url));
  }
  if (pathname.startsWith("/saccos/verify") && ![...ADMIN_TIER_ROLES, "DIRECTOR_MOBILITY", "CHIEF_OFFICER"].includes(role)) {
    return NextResponse.redirect(new URL(defaultHomeFor(role), request.url));
  }
  // Super Admin-only console: system health, config, admin-account management
  if (pathname.startsWith("/system") && role !== "SUPERADMIN") {
    return NextResponse.redirect(new URL(defaultHomeFor(role), request.url));
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
