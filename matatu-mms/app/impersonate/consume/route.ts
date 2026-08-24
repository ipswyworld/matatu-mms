import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/session";
import { parseJsonStringList, homeForRole } from "@/lib/rbac";
import { Role } from "@/lib/types";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

// The landing point for the ops console's "Impersonate" handoff. This must
// be a Route Handler, not a page: exchanging the ticket for a real session
// means writing the mms_session cookie, and Next.js only allows cookie
// mutation from a Server Action or a Route Handler — never from a Server
// Component during render (a plain page awaiting a "use server" function
// directly hits that restriction, which is what silently broke this flow
// the first time it was built as a page).
export async function GET(request: NextRequest) {
  const ticket = request.nextUrl.searchParams.get("ticket");
  if (!ticket) {
    return NextResponse.redirect(new URL("/impersonate/error?message=Missing+impersonation+ticket", request.url));
  }

  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}/api/auth/impersonate/consume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.redirect(
      new URL("/impersonate/error?message=Could+not+reach+the+authentication+server.+Please+try+again.", request.url)
    );
  }

  if (!res.ok) {
    let msg = "This impersonation link has expired. Start again from the ops console.";
    try {
      msg = (await res.json()).detail || msg;
    } catch {}
    return NextResponse.redirect(new URL(`/impersonate/error?message=${encodeURIComponent(msg)}`, request.url));
  }

  const data = await res.json();
  const targetRole = data.user.role as Role;
  await setSessionCookie({
    userId: data.user.id,
    name: data.user.name,
    role: targetRole,
    saccoId: data.user.saccoId,
    token: data.accessToken,
    additionalRoles: parseJsonStringList(data.user.additionalRoles) as Role[],
    impersonatedBy: { id: data.impersonatorId, name: data.impersonatorName },
  });

  return NextResponse.redirect(new URL(homeForRole(targetRole), request.url));
}
