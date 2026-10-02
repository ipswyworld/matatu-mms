import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import AuthSkyline from "./AuthSkyline";
import PublicFooter from "./PublicFooter";

export default function PublicLegalLayout({
  eyebrow,
  title,
  subtitle,
  icon: Icon,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen bg-county-cream overflow-hidden">
      <AuthSkyline heightClassName="h-[70vh]" />
      <header className="relative z-10 bg-county-green-deep text-white">
        <div className="h-1.5 flex">
          <div className="bg-county-green flex-1" />
          <div className="bg-county-yellow flex-1" />
          <div className="bg-county-red flex-1" />
        </div>
        <div className="max-w-3xl mx-auto px-5 py-8 md:py-12">
          <Link href="/login" className="inline-flex items-center gap-2 text-xs font-bold text-white/70 hover:text-white mb-6">
            <ArrowLeft size={13} strokeWidth={2.5} />
            Back to Sign in
          </Link>
          <div className="flex items-center gap-3 mb-6">
            <div className="h-11 w-11 rounded-xl bg-county-cream flex items-center justify-center overflow-hidden shadow-md shrink-0">
              <Image src="/nairobi-crest.jpg" alt="Nairobi City County" width={44} height={44} className="object-contain" />
            </div>
            <div className="leading-tight">
              <div className="font-black text-white text-sm">Nairobi City County</div>
              <div className="text-[10px] font-bold text-county-yellow tracking-[0.18em] uppercase mt-0.5">Mji-Move</div>
            </div>
          </div>
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-county-yellow">{eyebrow}</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight mt-2 text-balance flex items-center gap-3">
            {Icon && (
              <span className="hidden sm:flex h-9 w-9 shrink-0 rounded-xl bg-white/10 ring-1 ring-white/15 items-center justify-center text-county-yellow">
                <Icon size={18} strokeWidth={2} />
              </span>
            )}
            {title}
          </h1>
          <p className="text-sm text-white/70 mt-3 max-w-xl leading-relaxed">{subtitle}</p>
        </div>
      </header>

      <main className="relative z-10 max-w-3xl mx-auto px-5 py-10 md:py-14">{children}</main>

      <PublicFooter transparent />
    </div>
  );
}
