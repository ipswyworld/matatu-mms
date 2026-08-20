import type { Metadata } from "next";
import { getMatatus, getRoutes, getSaccos, getMyProfile } from "@/lib/data";
import PassengerBookingClient from "@/components/PassengerBookingClient";

export const metadata: Metadata = { title: "Passenger Booking & Scheduling" };

export default async function PassengerPortalPage() {
  const [routes, matatus, saccos, profile] = await Promise.all([
    getRoutes(),
    getMatatus(),
    getSaccos(),
    getMyProfile(),
  ]);
  const activeMatatus = matatus.filter((m) => m.status === "ACTIVE");

  return (
    <PassengerBookingClient
      routes={routes}
      matatus={activeMatatus}
      saccos={saccos}
      favoriteSaccoId={profile.favoriteSaccoId || null}
    />
  );
}
