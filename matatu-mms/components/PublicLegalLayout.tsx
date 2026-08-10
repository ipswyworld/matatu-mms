import Link from "next/link";
import Image from "next/image";

export default function PublicLegalLayout({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-county-cream">
      <header className="bg-county-green-deep text-white">
        <div className="h-1.5 flex">
          <div className="bg-county-green flex-1" />
          <div className="bg-county-yellow flex-1" />
          <div className="bg-county-red flex-1" />
        </div>
        <div className="max-w-3xl mx-auto px-5 py-8 md:py-12">
          <Link href="/login" className="inline-flex items-center gap-2 text-xs font-bold text-white/70 hover:text-white mb-6">
            ← Back to Sign in
          </Link>
          <div className="flex items-center gap-3 mb-6">
            <div className="h-11 w-11 rounded-xl bg-county-cream flex items-center justify-center overflow-hidden shadow-md shrink-0">
              <Image src="/nairobi-crest.jpg" alt="Nairobi City County" width={44} height={44} className="object-contain" />
            </div>
            <div className="leading-tight">
              <div className="font-black text-white text-sm">Nairobi City County</div>
              <div className="text-[10px] font-bold text-county-yellow tracking-[0.18em] uppercase mt-0.5">Matatu MMS</div>
            </div>
          </div>
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-county-yellow">{eyebrow}</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight mt-2 text-balance">{title}</h1>
          <p className="text-sm text-white/70 mt-3 max-w-xl leading-relaxed">{subtitle}</p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-10 md:py-14">{children}</main>

      <footer className="max-w-3xl mx-auto px-5 pb-12 text-center">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-county-ink/40">
          Nairobi City County Government · Matatu Management System
        </div>
      </footer>
    </div>
  );
}
