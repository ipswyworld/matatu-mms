import type { Metadata } from "next";
import { getMatatus, getRoutes, getSaccos, getMyFavorites, getMyRecents, getPendingRatings } from "@/lib/data";
import { getMyScheduledBookingsAction } from "@/lib/actions";
import PassengerBookingClient from "@/components/PassengerBookingClient";
import FavoritesRecents from "@/components/FavoritesRecents";
import TripRatingModal from "@/components/TripRatingModal";
import ScheduleBookingClient from "@/components/ScheduleBookingClient";

export const metadata: Metadata = { title: "Passenger Booking & Scheduling" };

export default async function PassengerPortalPage() {
  // 6 independent backend calls with no fault isolation by default: one
  // transient failure (a slow query, a momentary timeout) would otherwise
  // throw the whole Promise.all and crash this entire page to the generic
  // error boundary (the same bug already fixed on /dashboard and
  // /sacco-portal). Falling back to empty arrays degrades individual
  // widgets instead of taking down the whole booking page.
  //
  // getStages() (the full BRN stage list, hundreds of stops) used to be
  // fetched here just to plot every one as a dot on the passenger map —
  // GisMap.tsx no longer does that (a clean map until a trip is planned,
  // like Uber/Bolt), and TripPlanner's stage search already queries the
  // backend directly per keystroke, so this page has no remaining use for
  // the full list.
  let routes: Awaited<ReturnType<typeof getRoutes>> = [];
  let matatus: Awaited<ReturnType<typeof getMatatus>> = [];
  let saccos: Awaited<ReturnType<typeof getSaccos>> = [];
  let favorites: Awaited<ReturnType<typeof getMyFavorites>> = [];
  let recents: Awaited<ReturnType<typeof getMyRecents>> = [];
  let pendingRatings: Awaited<ReturnType<typeof getPendingRatings>> = [];
  let scheduledBookings: Awaited<ReturnType<typeof getMyScheduledBookingsAction>> = [];
  try {
    [routes, matatus, saccos, favorites, recents, pendingRatings, scheduledBookings] = await Promise.all([
      getRoutes(),
      getMatatus(),
      getSaccos(),
      getMyFavorites(),
      getMyRecents(),
      getPendingRatings(),
      getMyScheduledBookingsAction(),
    ]);
  } catch (err: any) {
    if (err?.digest?.startsWith("NEXT_REDIRECT")) throw err;
  }
  const activeMatatus = matatus.filter((m) => m.status === "ACTIVE");

  return (
    <div className="space-y-6">
      <FavoritesRecents favorites={favorites} recents={recents} saccos={saccos} />
      <PassengerBookingClient routes={routes} matatus={activeMatatus} saccos={saccos} />
      <ScheduleBookingClient routes={routes} initialScheduled={scheduledBookings} />
      <TripRatingModal pending={pendingRatings} />
    </div>
  );
}
