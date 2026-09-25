import type { Metadata } from "next";
import { LifeBuoy } from "lucide-react";
import { getSupportTickets, getUsers } from "@/lib/data";
import { STAFF_ROLES } from "@/lib/rbac";
import PageBanner from "@/components/PageBanner";
import SupportTicketsBoard from "@/components/SupportTicketsBoard";

export const metadata: Metadata = { title: "Support Tickets" };

export default async function SupportPage() {
  const [tickets, allUsers] = await Promise.all([getSupportTickets(), getUsers()]);
  const staff = allUsers.filter((u) => STAFF_ROLES.includes(u.role));

  return (
    <div className="space-y-6">
      <PageBanner
        icon={LifeBuoy}
        eyebrow="Nairobi City County · Administration"
        title="Support Tickets"
        subtitle="Lightweight triage — status, priority, and assignee. Not a full helpdesk system."
      />
      <SupportTicketsBoard tickets={tickets} staff={staff} />
    </div>
  );
}
