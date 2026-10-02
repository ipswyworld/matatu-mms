import type { Metadata } from "next";
import { Mail } from "lucide-react";
import PublicLegalLayout from "@/components/PublicLegalLayout";

export const metadata: Metadata = {
  title: "Contact Us",
  description: "Reach the Nairobi City County Transport Department for booking questions, fine disputes, operator onboarding, or general support.",
};

export default function ContactPage() {
  return (
    <PublicLegalLayout
      icon={Mail}
      eyebrow="Nairobi City County · Get in touch"
      title="Contact Us"
      subtitle="Questions about a booking, a fine, an operator application, or the system itself — reach the right desk below."
    >
      <div className="space-y-6 text-sm text-county-ink/80 leading-relaxed">
        <div className="card p-5 space-y-1.5">
          <h3 className="font-extrabold text-county-black text-base">County Transport Department</h3>
          <p>Nairobi City County Government, City Hall, Nairobi</p>
          <p>
            Phone: <a href="tel:+254202224411" className="text-county-green font-semibold hover:underline">+254 20 222 4411</a>
          </p>
          <p>
            Email: <a href="mailto:transport@nairobi.go.ke" className="text-county-green font-semibold hover:underline">transport@nairobi.go.ke</a>
          </p>
          <p className="text-xs text-county-ink/50 pt-1">Monday – Friday, 8:00 AM – 5:00 PM (East Africa Time)</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="card p-4">
            <h4 className="font-bold text-county-black text-sm mb-1">Enforcement &amp; fines</h4>
            <p className="text-xs text-county-ink/60">Dispute a citation or ask about a payment: <a href="mailto:enforcement@nairobi.go.ke" className="text-county-green font-semibold hover:underline">enforcement@nairobi.go.ke</a></p>
          </div>
          <div className="card p-4">
            <h4 className="font-bold text-county-black text-sm mb-1">Operator onboarding</h4>
            <p className="text-xs text-county-ink/60">Questions on your application: <a href="mailto:operators@nairobi.go.ke" className="text-county-green font-semibold hover:underline">operators@nairobi.go.ke</a></p>
          </div>
        </div>

        <p className="text-xs text-county-ink/50">
          For an urgent safety concern on a live route, use the in-app report from the Passenger Portal — those are routed directly to enforcement in real time.
        </p>
      </div>
    </PublicLegalLayout>
  );
}
