import type { Metadata } from "next";
import Link from "next/link";
import { Bus, Plus } from "lucide-react";
import { readSession } from "@/lib/session";
import { getMatatus, getRoutes, getSaccos } from "@/lib/data";
import { can } from "@/lib/rbac";
import PageBanner from "@/components/PageBanner";
import FleetFilterTable from "@/components/FleetFilterTable";

export const metadata: Metadata = { title: "Fleet Registry" };

export default async function MatatusPage() {
  const session = readSession()!;
  const isSacco = session.role === "SACCO_OPERATOR";

  // Fetch data in parallel
  const [allMatatus, saccos, routes] = await Promise.all([
    getMatatus(),
    getSaccos(),
    getRoutes(),
  ]);

  // Scoped once, server-side: an operator's fleet data never leaves the
  // server for other operators' vehicles. Search/route/operator filtering
  // is instant client-side filtering over this already-scoped set.
  const matatus = isSacco ? allMatatus.filter((m) => m.saccoId === session.saccoId) : allMatatus;

  return (
    <div className="space-y-4">
      <PageBanner
        icon={Bus}
        eyebrow="Nairobi City County · Fleet Registry"
        title="Operator Fleet Registry"
        subtitle={`${matatus.length} vehicle${matatus.length !== 1 ? "s" : ""} registered across Nairobi County routes.`}
        action={
          can(session.role, "add_matatu") && (
            <Link href="/matatus/new" className="rounded-lg px-3.5 py-2 text-xs font-bold bg-county-green text-white hover:bg-county-green-dark transition-colors flex items-center gap-1.5">
              <Plus size={14} strokeWidth={2.5} />
              Onboard New Vehicle
            </Link>
          )
        }
      />

      <FleetFilterTable matatus={matatus} routes={routes} saccos={saccos} isSacco={isSacco} />
    </div>
  );
}
