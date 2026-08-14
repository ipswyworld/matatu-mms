import Link from "next/link";
import type { Metadata } from "next";
import PublicLegalLayout from "@/components/PublicLegalLayout";

export const metadata: Metadata = {
  title: "Help & FAQ",
  description: "Answers to common questions about registering matatus, booking seats, paying fines, and using the Nairobi County Matatu Management System.",
};

interface QA {
  q: string;
  a: React.ReactNode;
}

function FaqSection({ title, items }: { title: string; items: QA[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-black tracking-tight text-county-ink">{title}</h2>
      <div className="space-y-2">
        {items.map((item, i) => (
          <details key={i} className="group rounded-xl border border-county-ink/10 bg-white open:shadow-sm">
            <summary className="cursor-pointer list-none flex items-center justify-between gap-3 px-4 py-3.5">
              <span className="font-bold text-sm text-county-ink">{item.q}</span>
              <span className="text-county-green group-open:rotate-45 transition-transform text-xl leading-none shrink-0">+</span>
            </summary>
            <div className="px-4 pb-4 text-sm text-county-ink/70 leading-relaxed">{item.a}</div>
          </details>
        ))}
      </div>
    </section>
  );
}

export default function FaqPage() {
  const crewFaqs: QA[] = [
    {
      q: "How do I get a Crew account?",
      a: (
        <>
          Register at the <Link href="/register" className="font-bold text-county-green hover:underline">sign-up page</Link>, choose
          &quot;Matatu Crew&quot;, and select the Operator you drive or conduct for. Your Operator can see every vehicle and crew
          member linked to their account, and the county Admin retains oversight of the whole system.
        </>
      ),
    },
    {
      q: "What does the \"GPS Broadcast\" toggle actually do?",
      a: (
        <>
          When it&apos;s on, your device sends your vehicle&apos;s live location, speed, and heading to the county system in real
          time, and passengers see your vehicle move on the live map in the Passenger Portal. When it&apos;s off, nothing is sent —
          your location is <strong>not</strong> tracked outside your active trips, and there is no background or off-duty tracking.
          If your browser can&apos;t get a GPS fix, the system falls back to a simulated position so the demo/testing flow still
          works, but real deployments should always use your device&apos;s actual GPS.
        </>
      ),
    },
    {
      q: "Why do I need to mark seats as occupied or empty?",
      a: "Seat status is what powers the live seat map passengers see when booking, and what the county uses to calculate real fleet occupancy. Tapping an empty seat records a walk-in cash fare against your vehicle; tapping an occupied seat (one without an online booking) cancels that record. Keeping this accurate protects you if there's ever a dispute about how many passengers were on board.",
    },
    {
      q: "How does ticket validation work?",
      a: "A passenger who booked online will have a ticket ID (e.g. PASS-178...). Enter it in the Ticket Validator and hit Verify — you'll see their name, seat, route, and fare. Once they've boarded, mark it \"Boarded\" so the seat can't be double-counted and the booking record is complete.",
    },
    {
      q: "Can I still collect cash from passengers who didn't book through the app?",
      a: "Yes. Tapping an empty seat on your seat map records a cash walk-in booking at the route's official fare automatically — you don't need to do anything extra. This keeps cash trips in the same real record as app bookings, which matters if a fare dispute or overcharging complaint ever comes up.",
    },
    {
      q: "What happens if I mark a seat wrong by mistake?",
      a: "Tap it again — an occupied seat you tap cancels that specific booking, freeing it back up. There's no penalty for correcting an honest mistake quickly. Repeated, unexplained seat manipulation is a different matter — see the Terms & Conditions.",
    },
    {
      q: "My vehicle got a fine or citation from an officer — what happens now?",
      a: "Enforcement officers issue citations independently of Crew. You'll see the fine reflected in your Operator's records, and the Operator is responsible for paying it from their dashboard. As Crew, you aren't the one who pays it, but you are expected to cooperate with any roadside inspection.",
    },
    {
      q: "Who sees the incident reports I send in?",
      a: "Incident alerts you log (breakdowns, delays, checkpoint issues) go into the shared Activity Log, visible to your Operator, County Enforcement, and Admin. This is the same real log used for compliance history on your vehicle.",
    },
    {
      q: "What counts as misuse of the system?",
      a: "Falsifying seat occupancy to inflate apparent revenue, spoofing your GPS location, refusing to honor a valid online booking, or charging more than the route's published fare. These are covered directly in the Terms & Conditions and can lead to account suspension by your Operator or the County.",
    },
    {
      q: "Is my personal data and location history safe?",
      a: (
        <>
          Your account data and trip telemetry are handled under the Kenya Data Protection Act, 2019. See the{" "}
          <Link href="/terms" className="font-bold text-county-green hover:underline">Terms &amp; Conditions</Link> for exactly what's
          collected, why, and who can access it.
        </>
      ),
    },
    {
      q: "Something in the app isn't working — who do I contact?",
      a: "Report it to your Operator first, since they manage your account and vehicle assignment directly. For system-wide issues, your Operator can escalate to the County Admin.",
    },
  ];

  const passengerFaqs: QA[] = [
    {
      q: "How do I book a seat?",
      a: "Open the Passenger Portal, pick your boarding stage and route, choose a vehicle from the live list, tap a free seat on the seat map, and confirm. You'll get a boarding pass with your seat number and fare to pay the crew directly on board.",
    },
    {
      q: "Can I cancel a booking?",
      a: "Yes — while it's still \"Confirmed\" (not yet boarded), open your boarding pass and tap Cancel Booking. The seat is released immediately for other passengers.",
    },
    {
      q: "What if a matatu overcharges me or a crew member behaves badly?",
      a: "Use the Feedback & Reports tab in the Passenger Portal to file a report. It goes directly to County Enforcement, who can escalate it into a formal citation against the vehicle.",
    },
  ];

  return (
    <PublicLegalLayout
      eyebrow="Help Centre"
      title="Frequently Asked Questions"
      subtitle="Answers for Drivers & Conductors, and for Commuters using the Nairobi Matatu Management System."
    >
      <div className="space-y-10">
        <FaqSection title="For Drivers & Conductors (Crew)" items={crewFaqs} />
        <FaqSection title="For Commuters" items={passengerFaqs} />
        <div className="rounded-xl bg-county-green-deep text-white p-5 text-sm">
          Still stuck? Read the full{" "}
          <Link href="/terms" className="font-bold text-county-yellow hover:underline">Terms &amp; Conditions</Link>, or ask your
          Operator to raise it with County Admin.
        </div>
      </div>
    </PublicLegalLayout>
  );
}
