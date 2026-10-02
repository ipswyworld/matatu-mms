/**
 * Service worker for the passenger app (Readiness List §11).
 *
 * A large share of this user base is on variable Kenyan mobile data, often
 * on lower-end Android devices. The failure this exists to prevent is the
 * one that makes an app feel broken rather than slow: tapping something,
 * losing signal, and getting a blank Chrome error page instead of anything
 * the app controls.
 *
 * Deliberately conservative about what it caches, because caching the
 * wrong thing in a transport app is worse than not caching at all:
 *
 *   - The app shell is cached, so navigation always renders something.
 *   - API responses are NEVER cached. A stale seat availability, vehicle
 *     position, or fine balance shown as current is actively harmful:
 *     someone books a taken seat, or believes a fine is paid when it is
 *     not. Network-only, with an honest offline response instead.
 *   - Live tracking is explicitly excluded. A cached position is a lie
 *     about where a moving vehicle is.
 */

const VERSION = "v1";
const SHELL_CACHE = `mms-shell-${VERSION}`;
const ASSET_CACHE = `mms-assets-${VERSION}`;

// Minimal: enough to render a usable frame offline. Route pages are added
// as they are visited rather than precached, since precaching every route
// costs data on a metered connection for pages most users never open.
const SHELL_URLS = ["/", "/offline"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      // A failed precache must not block activation — the worker is still
      // useful for everything else, and a hard failure here would leave the
      // user with no service worker at all.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Anything whose staleness could mislead someone about money or a vehicle. */
function isNeverCacheable(url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/track") ||
    url.pathname.includes("/telemetry") ||
    url.pathname.includes("/bookings") ||
    url.pathname.includes("/pay-fine")
  );
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    /\.(?:css|js|woff2?|ttf|png|jpg|jpeg|svg|webp|ico)$/i.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only GET. A cached POST replay would re-book a seat or re-submit a
  // payment — the exact duplicate-submission problem the backend's
  // idempotency layer exists to catch, and not one to create here.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isNeverCacheable(url)) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(
            JSON.stringify({
              offline: true,
              detail:
                "You appear to be offline. This information changes constantly, so it is not shown from a cache.",
            }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    return;
  }

  // Static assets are content-hashed by Next, so a cache hit is always the
  // right bytes for that URL — cache-first is safe and saves real data.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Navigations: network first so content is fresh, falling back to the
  // cached shell and finally to an offline page the app controls.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then((cached) => cached || caches.match("/offline"))
            .then(
              (cached) =>
                cached ||
                new Response("Offline", {
                  status: 503,
                  headers: { "Content-Type": "text/plain" },
                }),
            ),
        ),
    );
  }
});
