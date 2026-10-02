import { NextRequest, NextResponse } from "next/server";
import { verifyAndExtractPayload } from "./lib/sessionSign";
import { homeForRole } from "./lib/roles";

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
// "/offline" is the service worker's navigation fallback. It MUST be public:
// it is shown precisely when there is no network, and redirecting it to a
// sign-in page that itself needs network would make the offline experience
// worse than no service worker at all. It contains no user data.
// "/share" is Phase 7's trusted-contact trip link — deliberately
// unauthenticated (the whole point is someone with no account on this
// system can open it), gated instead by the opaque share_token itself
// plus the backend's own expiry check.
const PUBLIC_PATHS = ["/register", "/faq", "/terms", "/operator-onboarding", "/pay-fine", "/contact", "/forgot-password", "/reset-password", "/guardian-approve", "/compliance-notice", "/offline", "/status", "/share"];

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
  //
  // `webmanifest` was missing and PWA installation silently broke: the
  // browser fetches /manifest.webmanifest unauthenticated, got a 307 to the
  // sign-in page, and simply declined to offer installation with no error
  // anyone would notice. sw.js worked only because `js` happened to be in
  // this list, which made the omission harder to spot rather than easier.
  if (
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    // Next's generated metadata-file routes (app/opengraph-image.tsx etc.)
    // serve at this exact path with no file extension, so the regex below
    // never matches it — confirmed live: it redirected to "/" before this
    // explicit exemption was added.
    pathname === "/opengraph-image" ||
    /\.(png|jpg|jpeg|svg|webp|gif|ico|css|js|txt|xml|json|webmanifest|woff2?|ttf)$/i.test(pathname)
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

  // "/login" isn't a real route here — "/" is the sign-in page directly —
  // but it's a natural URL to type or link to from the staff app's own
  // "/login", so redirect rather than 404 on it.
  if (pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
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

  // Strict PASSENGER portal restriction: Passengers can only access
  // /passenger-portal and /feedback (its own sidebar-linked route, split
  // out of what used to be a tab inside /passenger-portal).
  if (role === "PASSENGER" && !pathname.startsWith("/passenger-portal") && !pathname.startsWith("/feedback")) {
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
