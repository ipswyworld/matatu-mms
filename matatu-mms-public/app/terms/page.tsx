import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import PublicLegalLayout from "@/components/PublicLegalLayout";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description: "Terms and conditions governing use of Nairobi City County's Mji-Move platform by passengers, crew, operators, and enforcement officers.",
};

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-county-ink/10 pt-6 first:border-0 first:pt-0">
      <h2 className="text-lg font-black tracking-tight text-county-ink flex items-baseline gap-2">
        <span className="text-county-green">{n}.</span> {title}
      </h2>
      <div className="mt-2.5 text-sm text-county-ink/75 leading-relaxed space-y-3">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <PublicLegalLayout
      icon={ScrollText}
      eyebrow="Legal"
      title="Terms & Conditions"
      subtitle="Governing use of Nairobi City County's Mji-Move platform, with dedicated obligations for Crew (drivers and conductors). Last updated: 2026."
    >
      <div className="space-y-8">
        <Section n="1" title="Acceptance of these Terms">
          <p>
            By creating an account or otherwise using Nairobi City County's Mji-Move platform (&quot;the System&quot;), you
            agree to these Terms & Conditions. If you do not agree, do not register for or use the System. These Terms apply to all
            account types: County Admin, Enforcement Officers, Operators, Crew (drivers and conductors), and Passengers, with
            additional obligations for Crew set out in Section 4.
          </p>
        </Section>

        <Section n="2" title="Definitions">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>&quot;County&quot;</strong> means the Nairobi City County Government, operator of the System.</li>
            <li><strong>&quot;Operator&quot;</strong> means a registered matatu Savings and Credit Cooperative Organisation onboarded onto the System.</li>
            <li><strong>&quot;Crew&quot;</strong> means a driver or conductor account, linked to exactly one Operator and its registered vehicles.</li>
            <li><strong>&quot;Vehicle&quot;</strong> means a matatu registered under an Operator within the System, identified by its number plate.</li>
            <li><strong>&quot;Booking&quot;</strong> means a seat reservation created through the System, whether by a Passenger online or by Crew recording a cash walk-in fare.</li>
          </ul>
        </Section>

        <Section n="3" title="Eligibility & Account Registration">
          <p>
            Crew accounts must be affiliated with an Operator that is active and verified within the System. You must provide accurate
            identity information at registration. Operators are responsible for confirming that Crew registered under their
            Operator are genuinely engaged to drive or conduct the vehicles assigned to them. The County reserves the right to request
            verification of any account at any time.
          </p>
        </Section>

        <Section n="4" title="Crew Responsibilities">
          <p>As a driver or conductor using the System, you agree to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Accurately reflect seat occupancy on your assigned vehicle — mark a seat occupied only when a passenger genuinely boards, and free it when they alight or a booking is cancelled.</li>
            <li>Validate a passenger&apos;s ticket honestly before honoring it, and mark it &quot;Boarded&quot; once the passenger is on board.</li>
            <li>Charge no more than the route&apos;s published, gazetted fare, for both online bookings and cash walk-in passengers.</li>
            <li>Broadcast your vehicle&apos;s live location only through the System&apos;s own GPS feature, and only while genuinely operating the route — never a fabricated, spoofed, or replayed position.</li>
            <li>Report incidents (breakdowns, safety issues, checkpoint delays) promptly and truthfully through the Crew Dashboard.</li>
            <li>Cooperate with roadside inspections carried out by County Enforcement Officers.</li>
          </ul>
        </Section>

        <Section n="5" title="GPS & Location Data">
          <p>
            The System collects your vehicle&apos;s GPS coordinates, speed, and heading only while your &quot;GPS Broadcast&quot;
            toggle is switched on, which is intended to correspond to active driving time on a route. This data is used solely to:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Show passengers your vehicle&apos;s live position so they can plan their journey and confirm the correct vehicle;</li>
            <li>Give the County and your Operator visibility into whether a vehicle is actively in service.</li>
          </ul>
          <p>
            Location data is not collected while the toggle is off, and is not used to monitor you outside your work on the route.
            Location history is retained only as long as reasonably necessary for operational and compliance records, and is
            processed under the Kenya Data Protection Act, 2019.
          </p>
        </Section>

        <Section n="6" title="Fare Collection & Cash Handling">
          <p>
            Online bookings are settled by the passenger paying the crew directly on boarding, referencing the fare shown on their
            boarding pass. A dedicated payment gateway integration (NairobiPay) for automatic, cashless settlement of fines and
            permits is planned and will be announced separately — until then, cash handling and fare collection remain a Crew and
            Operator responsibility, and every transaction is still recorded in the System for audit purposes.
          </p>
        </Section>

        <Section n="7" title="Prohibited Conduct">
          <p>The following are strictly prohibited and may result in immediate account suspension:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Falsifying seat occupancy or booking records to misrepresent vehicle usage or revenue.</li>
            <li>Spoofing, replaying, or otherwise fabricating GPS telemetry.</li>
            <li>Charging fares above the published rate for a route (overcharging).</li>
            <li>Refusing to honor a valid, paid online booking without cause.</li>
            <li>Harassment, discrimination, or unsafe conduct toward passengers or fellow Crew.</li>
            <li>Sharing your account credentials with another individual.</li>
          </ul>
        </Section>

        <Section n="8" title="Fines, Citations & Compliance">
          <p>
            Citations and fines are issued exclusively by County Enforcement Officers and are recorded against the Vehicle, visible
            to its Operator and County Admin. Settling a fine is the Operator&apos;s responsibility, not Crew&apos;s directly.
            Repeated citations against a vehicle may affect its operating status independent of any individual Crew account.
          </p>
        </Section>

        <Section n="9" title="Account Suspension & Termination">
          <p>
            An Operator may deactivate a Crew account linked to their Operator at any time. The County Admin may suspend any
            account, Crew included, for violation of these Terms, for fraudulent activity, or at the request of law enforcement.
            Suspension does not entitle you to a refund of any fees or waive any outstanding citation.
          </p>
        </Section>

        <Section n="10" title="Data Privacy">
          <p>
            Personal data (name, phone number, email, Operator affiliation) and operational data (GPS telemetry while broadcasting,
            seat/booking records, ticket validations, incident reports) are processed by the County in accordance with the Kenya
            Data Protection Act, 2019. This data is accessible to: your own Operator (your records only), County Admin and
            Enforcement (system-wide, for compliance oversight), and is never sold or shared with third parties outside the County's
            operational and legal obligations.
          </p>
        </Section>

        <Section n="11" title="Limitation of Liability">
          <p>
            The System is an operational and compliance tool. It does not guarantee a minimum number of bookings, fares, or income
            for any Crew member or Operator, and the County is not liable for lost income arising from system downtime, GPS
            inaccuracy, or passenger no-shows. Nothing in these Terms limits liability for fraud, willful misconduct, or death or
            personal injury caused by negligence, to the extent such limitation is not permitted under the laws of Kenya.
          </p>
        </Section>

        <Section n="12" title="Changes to these Terms">
          <p>
            The County may update these Terms from time to time as the System evolves. Continued use of the System after an update
            constitutes acceptance of the revised Terms. Material changes affecting Crew obligations will be communicated through
            the Crew Dashboard.
          </p>
        </Section>

        <Section n="13" title="Governing Law">
          <p>
            These Terms are governed by the laws of Kenya, including applicable Nairobi City County bylaws and regulations
            governing public service vehicles.
          </p>
        </Section>

        <Section n="14" title="Contact">
          <p>
            Crew members should direct questions about their account or these Terms to their Operator in the first instance.
            Operators may escalate system-wide concerns to the Nairobi City County Government's Mji-Move
            administration.
          </p>
        </Section>
      </div>
    </PublicLegalLayout>
  );
}
