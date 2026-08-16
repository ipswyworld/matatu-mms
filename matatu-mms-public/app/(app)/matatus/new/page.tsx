import Link from "next/link";
import { ArrowLeft, Bus } from "lucide-react";
import { readSession } from "@/lib/session";
import { getSaccos, getRoutes } from "@/lib/data";
import NewMatatuForm from "./NewMatatuForm";

export default async function NewMatatuPage() {
  const session = readSession()!;
  const isOperator = session.role === "SACCO_OPERATOR";

  const [saccos, routes] = await Promise.all([
    isOperator ? Promise.resolve([]) : getSaccos(),
    getRoutes(),
  ]);

  return (
    <div className="max-w-lg">
      <Link href="/matatus" className="text-xs font-semibold text-county-green hover:underline inline-flex items-center gap-1">
        <ArrowLeft size={13} strokeWidth={2.5} />
        Back to registry
      </Link>
      <div className="card p-6 mt-3">
        <h2 className="font-bold mb-4 flex items-center gap-2">
          <Bus size={18} strokeWidth={2} className="text-county-green" />
          Register a vehicle
        </h2>
        <NewMatatuForm
          viewerRole={session.role}
          viewerSaccoId={session.saccoId}
          saccos={saccos}
          routes={routes}
        />
      </div>
    </div>
  );
}
