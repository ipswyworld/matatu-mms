import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { getSaccos } from "@/lib/data";
import NairobiCrest from "@/components/NairobiCrest";
import MatatuGlyph from "@/components/MatatuGlyph";
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
    <main className="min-h-screen bg-county-black text-white flex flex-col justify-center items-center p-4 relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(-45deg, #FCDD07 0px, #FCDD07 14px, transparent 14px, transparent 28px)",
        }}
      />
      <div className="pointer-events-none absolute -right-10 -bottom-10 text-white opacity-[0.08]">
        <MatatuGlyph size={280} />
      </div>

      <div className="w-full max-w-lg space-y-6 relative z-10">
        <div className="text-center space-y-2">
          <NairobiCrest size={52} className="mx-auto drop-shadow-lg" />
          <h1 className="text-xl font-extrabold tracking-tight text-white">{sacco.name}</h1>
          <p className="text-xs font-semibold text-county-yellow uppercase tracking-widest">
            Operator Onboarding — Verification Application
          </p>
        </div>

        <div className="bg-white/[0.06] border border-white/10 p-6 rounded-2xl shadow-2xl">
          <OperatorOnboardingWizard sacco={sacco} />
        </div>
      </div>
    </main>
  );
}
