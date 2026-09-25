import { NextRequest, NextResponse } from "next/server";
import { verifyAndExtractPayload } from "./lib/sessionSign";

const SESSION_COOKIE_NAME = "mms_ops_session";
const PUBLIC_PATHS = ["/login", "/mfa-verify"];

async function readVerifiedSession(request: NextRequest): Promise<{ role: string | null; mfaSetupRequired: boolean }> {
  const raw = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) return { role: null, mfaSetupRequired: false };
  const payloadBase64 = await verifyAndExtractPayload(raw);
  if (!payloadBase64) return { role: null, mfaSetupRequired: false };
  try {
    const json = Buffer.from(payloadBase64, "base64").toString("utf-8");
    const parsed = JSON.parse(json);
    return { role: (parsed.role as string) ?? null, mfaSetupRequired: !!parsed.mfaSetupRequired };
  } catch {
    return { role: null, mfaSetupRequired: false };
  }
}

// This console has no MFA-setup UI of its own — enrollment happens in the
// staff app, which every SUPERADMIN also has an account on. Same env var
// pattern already used for the impersonation ticket-consume redirect
// (lib/actions.ts) and the operator-onboarding launcher.
const STAFF_APP_URL = process.env.STAFF_APP_URL || "http://localhost:3000";

// Two layers of RBAC by design: this middleware (fast, edge-runtime reject
// on a tampered/absent/non-SUPERADMIN cookie) plus the backend's own
// requires_permission("view_system_health") check on every API call this
// app makes — belt and suspenders for the most sensitive console in the
// system, same reasoning as the :3002 nginx network restriction it sits
// behind (ADMIN_DASHBOARD_AUDIT §4.3).
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // `webmanifest` and `txt` were both missing — confirmed live: fetching
  // /manifest.webmanifest or /robots.txt unauthenticated 307-redirected to
  // /login instead of serving the file, the same silent-PWA-break class of
  // bug already found and fixed in the public app's middleware.
  if (
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/api/health" ||
    /\.(png|jpg|jpeg|svg|webp|gif|ico|css|js|txt|xml|webmanifest|woff2?|ttf)$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const { role, mfaSetupRequired } = await readVerifiedSession(request);

  if (role !== "SUPERADMIN") {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }

  if (mfaSetupRequired) {
    return NextResponse.redirect(`${STAFF_APP_URL}/mfa/setup`);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
