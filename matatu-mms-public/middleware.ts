import { NextRequest, NextResponse } from "next/server";
import { verifyAndExtractPayload } from "./lib/sessionSign";

const SESSION_COOKIE_NAME = "mms_session";

// Never add "/" here. This list is matched with `startsWith`, and every
// path starts with "/" — doing so would silently mark the entire app as
// public and disable auth enforcement everywhere. Root is handled as its
// own exact-match case below instead.
//
// This is the public-facing app (passengers, crew, and Sacco operators).
// County staff (admin, enforcement, director/chief officer, viewer) sign
// in through a completely separate app/deployment and never reach this
// middleware at all.
const PUBLIC_PATHS = ["/register", "/faq", "/terms", "/operator-onboarding", "/pay-fine", "/contact", "/forgot-password", "/reset-password"];

// Single source of truth for "where does this role land by default" — used
// for sending an already-authenticated user away from the public landing
// page and for the strict per-role portal confinement below.
function homeForRole(role: string): string {
  if (role === "PASSENGER") return "/passenger-portal";
  if (role === "CREW") return "/crew-portal";
  return "/sacco-portal";
}

/**
 * Verifies the HMAC signature before trusting anything in the cookie. A
 * tampered/forged cookie fails verification here and is redirected to "/"
 * exactly like having no session at all — this is the actual security
 * boundary; lib/session.ts's readSession() trusts that requests reaching a
 * page have already passed through here.
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

  // Next.js internals + any static file in /public (identified by file extension)
  if (
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    /\.(png|jpg|jpeg|svg|webp|gif|ico|css|js|txt|xml|woff2?|ttf)$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  const role = await readVerifiedRole(request);

  // Root is the public portal (booking, registration, sign-in) — shown to
  // guests. An already-authenticated user hitting "/" gets sent to their
  // own home instead of the marketing/sign-in page.
  if (pathname === "/") {
    if (!role) return NextResponse.next();
    return NextResponse.redirect(new URL(homeForRole(role), request.url));
  }

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (!role) {
    const loginUrl = new URL("/", request.url);
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

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
