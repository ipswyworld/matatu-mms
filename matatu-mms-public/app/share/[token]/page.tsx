import type { Metadata } from "next";
import { Share2 } from "lucide-react";
import { getScheduledBookingShare } from "@/lib/data";
import PublicLegalLayout from "@/components/PublicLegalLayout";
import ShareTripClient from "@/components/ShareTripClient";

export const metadata: Metadata = {
  title: "Shared Trip",
  description: "Live status of a scheduled matatu trip, shared by a passenger.",
};

export const dynamic = "force-dynamic";

export default async function SharedTripPage({ params }: { params: { token: string } }) {
  const initial = await getScheduledBookingShare(params.token);

  return (
    <PublicLegalLayout
      icon={Share2}
      eyebrow="Nairobi City County · Shared Trip"
      title="Trip Status"
      subtitle="Someone shared their scheduled matatu trip with you — no account needed to view it."
    >
      <ShareTripClient token={params.token} initial={initial} />
    </PublicLegalLayout>
  );
}
