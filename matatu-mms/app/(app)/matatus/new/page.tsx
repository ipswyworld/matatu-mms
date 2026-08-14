import Link from "next/link";
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
      <Link href="/matatus" className="text-xs font-semibold text-county-green hover:underline">← Back to registry</Link>
      <div className="card p-6 mt-3">
        <h2 className="font-bold mb-4">Register a vehicle</h2>
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
