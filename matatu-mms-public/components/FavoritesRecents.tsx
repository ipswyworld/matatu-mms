"use client";

import { useState, useTransition } from "react";
import { Clock, Star, X } from "lucide-react";
import { addFavoriteSaccoAction, removeFavoriteSaccoAction } from "@/lib/actions";
import { RecentSacco, Sacco, UserFavorite } from "@/lib/types";

interface FavoritesRecentsProps {
  favorites: UserFavorite[];
  recents: RecentSacco[];
  saccos: Sacco[];
}

/**
 * Real, multi-value favorites (add/remove any number of operators) plus a
 * "recently used" list derived from the passenger's own booking history —
 * both scoped to sacco/operator, per the ask. Recents needs no storage of
 * its own: it's just the distinct operators from recent bookings.
 */
export default function FavoritesRecents({ favorites, recents, saccos }: FavoritesRecentsProps) {
  const [localFavorites, setLocalFavorites] = useState(favorites);
  const [isPending, startTransition] = useTransition();
  const saccoById = new Map(saccos.map((s) => [s.id, s]));

  const isFavorite = (saccoId: string) => localFavorites.some((f) => f.saccoId === saccoId);

  const toggle = (saccoId: string) => {
    if (isFavorite(saccoId)) {
      setLocalFavorites((prev) => prev.filter((f) => f.saccoId !== saccoId));
      startTransition(async () => {
        await removeFavoriteSaccoAction(saccoId);
      });
    } else {
      const optimistic: UserFavorite = { id: `pending-${saccoId}`, saccoId, createdAt: new Date().toISOString() };
      setLocalFavorites((prev) => [...prev, optimistic]);
      startTransition(async () => {
        await addFavoriteSaccoAction(saccoId);
      });
    }
  };

  const recentSaccosNotFavorited = recents
    .map((r) => saccoById.get(r.saccoId))
    .filter((s): s is Sacco => Boolean(s) && !isFavorite(s!.id));

  // Operators not yet favorited and not already shown under "Recently
  // Used" — the browsable add-a-favorite list for passengers with no
  // booking history yet. Previously this whole card returned null until a
  // passenger had favorites or recents, which meant a first-time user could
  // never find "Favorites" at all; it always renders now.
  const recentIds = new Set(recentSaccosNotFavorited.map((s) => s.id));
  const browsableSaccos = saccos.filter((s) => !isFavorite(s.id) && !recentIds.has(s.id));

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <h3 className="font-bold text-[11px] text-county-black/50 flex items-center gap-1.5 uppercase tracking-wide">
          <Star size={12} strokeWidth={2} className="text-county-yellow" fill="currentColor" />
          Favorite Operators
        </h3>
        {localFavorites.length === 0 ? (
          <p className="text-xs text-black/40 italic">
            No favorites yet — tap an operator below to save it for quicker booking next time.
          </p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-ghost">
            {localFavorites.map((fav) => {
              const sacco = saccoById.get(fav.saccoId);
              return (
                <span
                  key={fav.saccoId}
                  className="inline-flex items-center gap-1.5 badge bg-county-yellow/10 text-county-black font-bold shrink-0"
                >
                  {sacco?.name || fav.saccoId}
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => toggle(fav.saccoId)}
                    aria-label={`Remove ${sacco?.name || "operator"} from favorites`}
                    className="text-county-black/40 hover:text-county-red"
                  >
                    <X size={11} strokeWidth={2.5} />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {recentSaccosNotFavorited.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="font-bold text-[11px] text-county-black/50 flex items-center gap-1.5 uppercase tracking-wide">
            <Clock size={12} strokeWidth={2} className="text-county-ink/40" />
            Recently Used
          </h3>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-ghost">
            {recentSaccosNotFavorited.map((sacco) => (
              <button
                key={sacco.id}
                type="button"
                disabled={isPending}
                onClick={() => toggle(sacco.id)}
                className="inline-flex items-center gap-1.5 badge bg-black/5 text-county-black/70 font-bold hover:bg-county-yellow/10 shrink-0"
              >
                <Star size={11} strokeWidth={2} />
                {sacco.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {browsableSaccos.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="font-bold text-[11px] text-county-black/50 flex items-center gap-1.5 uppercase tracking-wide">
            Add a Favorite
          </h3>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-ghost">
            {browsableSaccos.slice(0, 8).map((sacco) => (
              <button
                key={sacco.id}
                type="button"
                disabled={isPending}
                onClick={() => toggle(sacco.id)}
                className="inline-flex items-center gap-1.5 badge bg-black/5 text-county-black/50 font-bold hover:bg-county-yellow/10 hover:text-county-black shrink-0"
              >
                <Star size={11} strokeWidth={2} />
                {sacco.name}
              </button>
            ))}
            {browsableSaccos.length > 8 && (
              <span className="text-[11px] text-black/30 self-center font-semibold shrink-0">
                +{browsableSaccos.length - 8} more operators
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
