import { getMatatus, getRoutes } from "@/lib/data";
import PassengerBookingClient from "@/components/PassengerBookingClient";

export default async function PassengerPortalPage() {
  const [routes, matatus] = await Promise.all([getRoutes(), getMatatus()]);
  const activeMatatus = matatus.filter((m) => m.status === "ACTIVE");

  return <PassengerBookingClient routes={routes} matatus={activeMatatus} />;
}
