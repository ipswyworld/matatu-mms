import { redirect } from "next/navigation";
import Image from "next/image";
import { readSession } from "@/lib/session";
import { getSaccos } from "@/lib/data";
import OperatorOnboardingWizard from "@/components/OperatorOnboardingWizard";

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
    <main className="min-h-screen bg-county-black text-white flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-3">
          <div className="h-16 w-16 rounded-2xl bg-county-cream flex items-center justify-center overflow-hidden shadow-lg mx-auto">
            <Image src="/nairobi-crest.jpg" alt="Nairobi City County" width={64} height={64} className="object-contain" priority />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-county-yellow">
              Nairobi City County · Operator Verification
            </div>
            <h1 className="text-xl font-extrabold tracking-tight text-white mt-1">{sacco.name}</h1>
          </div>
        </div>

        <div className="bg-white/[0.06] border border-white/10 p-6 rounded-2xl shadow-2xl">
          <OperatorOnboardingWizard sacco={sacco} />
        </div>
      </div>
    </main>
  );
}
