import { NextResponse } from "next/server";

// Liveness probe for the Next.js server itself — deliberately doesn't call
// the backend, so a slow/unreachable FastAPI service fails its own health
// check rather than taking this process down with it.
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
