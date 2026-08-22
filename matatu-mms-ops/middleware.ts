import { NextRequest, NextResponse } from "next/server";
import { verifyAndExtractPayload } from "./lib/sessionSign";

const SESSION_COOKIE_NAME = "mms_ops_session";
const PUBLIC_PATHS = ["/login", "/mfa-verify"];

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

// Two layers of RBAC by design: this middleware (fast, edge-runtime reject
// on a tampered/absent/non-SUPERADMIN cookie) plus the backend's own
// requires_permission("view_system_health") check on every API call this
// app makes — belt and suspenders for the most sensitive console in the
// system, same reasoning as the :3002 nginx network restriction it sits
// behind (ADMIN_DASHBOARD_AUDIT §4.3).
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/api/health" ||
    /\.(png|jpg|jpeg|svg|webp|gif|ico|css|js|woff2?|ttf)$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const role = await readVerifiedRole(request);

  if (role !== "SUPERADMIN") {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
