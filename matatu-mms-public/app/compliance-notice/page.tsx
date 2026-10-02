import Link from "next/link";
import type { Metadata } from "next";
import { ShieldAlert, ArrowRight } from "lucide-react";
import PublicLegalLayout from "@/components/PublicLegalLayout";

export const metadata: Metadata = {
  title: "Mandatory Operator Registration",
  description: "Nairobi City County requires every matatu Sacco and operator to register on Mji-Move.",
};

export default function ComplianceNoticePage() {
  return (
    <PublicLegalLayout
      icon={ShieldAlert}
      eyebrow="Nairobi City County · Compliance Notice"
      title="Every Operator Must Register"
      subtitle="If you received an SMS from Nairobi City County about this page, your Sacco or operator has been identified as not yet registered on Mji-Move."
    >
      <div className="space-y-6 text-sm text-county-ink/70 leading-relaxed">
        <p>
          Nairobi City County now manages operator verification, fleet compliance, and route licensing for the matatu
          sector through this system. Every Sacco and operator running vehicles in the county is required to register,
          regardless of how long you&apos;ve been operating.
        </p>

        <div className="rounded-xl border border-county-red/20 bg-county-red/5 p-5 space-y-2">
          <h2 className="font-black text-county-ink">What happens if you don&apos;t register</h2>
          <p>
            Unregistered vehicles are not on record with the county and cannot be verified during roadside enforcement
            checks. Registration is free and takes about 10 minutes to start — you can save your progress and finish
            uploading documents later.
          </p>
        </div>

        <div className="space-y-2">
          <h2 className="font-black text-county-ink">What you&apos;ll need</h2>
          <ul className="list-disc list-inside space-y-1">
            <li>Registration Certificate</li>
            <li>Road Service License (RSL)</li>
            <li>Permit from the County</li>
            <li>Single Business Permit (SBP)</li>
            <li>Tax Compliance Certificate</li>
            <li>Fare Chart</li>
            <li>Bonafide Officials&apos; contacts (Chairperson, Secretary, Treasurer)</li>
          </ul>
        </div>

        <Link
          href="/operator-onboarding"
          className="btn-primary w-full font-bold flex items-center justify-center gap-2"
        >
          Start Registration Now
          <ArrowRight size={15} strokeWidth={2.5} />
        </Link>

        <p className="text-xs text-county-ink/50">
          Already registered, or think you received this notice by mistake? Contact your Sacco&apos;s registered admin, or
          reach the county through the{" "}
          <Link href="/contact" className="font-bold text-county-green hover:underline">Contact Us</Link> page.
        </p>
      </div>
    </PublicLegalLayout>
  );
}
