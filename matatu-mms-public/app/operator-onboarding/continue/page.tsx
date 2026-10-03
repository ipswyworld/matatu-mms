import { redirect } from "next/navigation";
import Image from "next/image";
import { readSession } from "@/lib/session";
import { getSaccos } from "@/lib/data";
import OperatorOnboardingWizard from "@/components/OperatorOnboardingWizard";
import AuthSkyline from "@/components/AuthSkyline";
import PublicFooter from "@/components/PublicFooter";

// Same cream/skyline template as the rest of the auth family — this page
// (and OperatorOnboardingWizard.tsx, which it's the sole caller of)
// previously ran its own bespoke dark theme, inconsistent with
// /operator-onboarding and every other auth-family page.
export default async function OperatorOnboardingContinuePage() {
  const session = readSession()!;
  if (session.role !== "SACCO_OPERATOR") {
    redirect("/dashboard");
  }

  const saccos = await getSaccos();
  const sacco = saccos.find((s) => s.id === session.saccoId);

  if (!sacco) {
    redirect("/sacco-portal");
  }
  if (sacco.status === "ACTIVE") {
    redirect("/sacco-portal");
  }

  return (
    <main className="relative min-h-screen bg-county-cream flex flex-col overflow-hidden">
      <AuthSkyline heightClassName="h-[70vh]" />
      <div className="relative z-10 flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-lg space-y-6">
          <div className="text-center space-y-3">
            <Image src="/nairobi-crest.jpg" alt="Nairobi City County" width={48} height={48} className="mx-auto object-contain drop-shadow" priority />
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-county-green">
                Nairobi City County · Operator Verification
              </div>
              <h1 className="text-2xl font-black tracking-tight text-county-ink mt-1">{sacco.name}</h1>
            </div>
          </div>

          <div className="card p-6 auth-card-enter">
            <OperatorOnboardingWizard sacco={sacco} />
          </div>
        </div>
      </div>
      <PublicFooter transparent />
    </main>
  );
}
