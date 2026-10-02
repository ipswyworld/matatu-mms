import type { Metadata } from "next";
import { getMatatus, getRoutes, getSaccos, getMyFavorites, getMyRecents, getPendingRatings } from "@/lib/data";
import { getMyScheduledBookingsAction } from "@/lib/actions";
import PassengerBookingClient from "@/components/PassengerBookingClient";
import FavoritesRecents from "@/components/FavoritesRecents";
import TripRatingModal from "@/components/TripRatingModal";
import ScheduleBookingClient from "@/components/ScheduleBookingClient";
import PassengerPortalTabs from "@/components/PassengerPortalTabs";

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
  const upcomingScheduledCount = scheduledBookings.filter(
    (s) => s.status === "PENDING" || s.status === "CONFIRMED"
  ).length;

  return (
    <>
      <PassengerPortalTabs
        scheduledCount={upcomingScheduledCount}
        bookNow={<PassengerBookingClient routes={routes} matatus={activeMatatus} saccos={saccos} />}
        scheduled={<ScheduleBookingClient routes={routes} initialScheduled={scheduledBookings} />}
        saved={
          <div className="space-y-3">
            <p className="text-xs text-black/50">
              Operators you've favorited or used recently — save one to book with it faster next time.
            </p>
            <FavoritesRecents favorites={favorites} recents={recents} saccos={saccos} />
          </div>
        }
      />
      <TripRatingModal pending={pendingRatings} />
    </>
  );
}
