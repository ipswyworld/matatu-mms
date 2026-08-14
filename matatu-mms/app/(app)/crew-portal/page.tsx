import type { Metadata } from "next";
import { getMatatus, getRoutes } from "@/lib/data";
import { readSession } from "@/lib/session";
import CrewPortalClient from "@/components/CrewPortalClient";

export const metadata: Metadata = { title: "Driver & Conductor Live Dashboard" };

export default async function CrewPortalPage() {
  const session = readSession()!;
  const [matatus, routes] = await Promise.all([getMatatus(), getRoutes()]);
  const assignedMatatus = matatus.filter((m) => m.status === "ACTIVE");

  return <CrewPortalClient matatus={assignedMatatus} routes={routes} token={session.token || ""} />;
}
