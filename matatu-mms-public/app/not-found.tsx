import type { Metadata } from "next";
import Link from "next/link";
import MatatuGlyph from "@/components/MatatuGlyph";
import PublicFooter from "@/components/PublicFooter";
import { readSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Page Not Found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  const session = readSession();

  return (
    <div className="min-h-screen flex flex-col bg-county-cream">
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="mx-auto h-24 w-24 rounded-2xl bg-county-green-deep flex items-center justify-center text-county-yellow shadow-elevated">
            <MatatuGlyph size={56} />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-county-green">Error 404</div>
            <h1 className="text-3xl font-black tracking-tight text-county-ink mt-2">This route doesn&apos;t exist</h1>
            <p className="text-sm text-county-ink/60 mt-3 leading-relaxed">
              The page you&apos;re looking for isn&apos;t part of the Matatu Management System, or you may not
              have the right terminus for it. Let&apos;s get you back on route.
            </p>
          </div>
          <Link href={session ? "/dashboard" : "/login"} className="btn-primary inline-flex !px-6">
            {session ? "Return to Dashboard" : "Return to Sign In"}
          </Link>
        </div>
      </div>
      <PublicFooter />
    </div>
  );
}
