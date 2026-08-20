import type { Metadata } from "next";
import { MessageSquareWarning } from "lucide-react";
import { getMyProfile } from "@/lib/data";
import PageBanner from "@/components/PageBanner";
import PassengerFeedbackForm from "@/components/PassengerFeedbackForm";

export const metadata: Metadata = { title: "Feedback & Reports" };

export default async function FeedbackPage() {
  const profile = await getMyProfile();

  return (
    <div className="space-y-6">
      <PageBanner
        icon={MessageSquareWarning}
        eyebrow="Nairobi City County · Commuter Portal"
        title="Feedback & Reports"
        subtitle="Report overcharging, reckless driving, or safety issues directly to County Traffic Enforcement."
      />
      <PassengerFeedbackForm passengerName={profile.name} />
    </div>
  );
}
