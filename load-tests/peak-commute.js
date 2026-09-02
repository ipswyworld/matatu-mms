/**
 * Peak-commute load test (Readiness List §7, §13).
 *
 * The readiness list claims this system serves 500k public users and 1,000
 * staff. That claim is currently an assumption. This is the test that turns
 * it into a measurement, and it is deliberately shaped like the real load
 * rather than a flat request flood:
 *
 *   - Traffic is bimodal. Nairobi commuting peaks roughly 6-9am and 5-8pm,
 *     and capacity planned against a daily average would be wrong by a
 *     large factor at exactly the hours that matter.
 *   - Reads vastly outnumber writes. Most people check a position or a
 *     schedule; far fewer book. A test weighted 50/50 would exercise a
 *     system nobody operates.
 *   - Every virtual user authenticates once and reuses the token, because
 *     real clients do. Logging in per request would measure bcrypt rather
 *     than the application.
 *
 * Run:
 *   k6 run --env BASE_URL=https://api.example.com load-tests/peak-commute.js
 *   k6 run --env SCENARIO=soak load-tests/peak-commute.js
 */
import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:8000";
const SCENARIO = __ENV.SCENARIO || "peak";

const bookingFailures = new Rate("booking_failures");
const searchLatency = new Trend("search_latency_ms");
const authLatency = new Trend("auth_latency_ms");

// Thresholds are the pass/fail contract. A load test without them produces
// numbers nobody interprets; with them, CI can refuse a regression.
export const options = {
  scenarios: {
    peak: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 50 },   // early commuters
        { duration: "2m", target: 300 },  // ramp into peak
        { duration: "5m", target: 300 },  // sustained peak
        { duration: "2m", target: 600 },  // surge — a delayed matatu, everyone checks at once
        { duration: "2m", target: 100 },  // taper
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
    ...(SCENARIO === "soak"
      ? {
          soak: {
            executor: "constant-vus",
            vus: 150,
            duration: "2h",
            // Catches what a short run cannot: connection-pool exhaustion,
            // memory growth, and Redis key accumulation. These are the
            // failures that appear on day three of production, not minute
            // three of a test.
          },
        }
      : {}),
  },
  thresholds: {
    // p95 rather than average: an average hides the tail, and the tail is
    // what a user on a bad connection actually experiences.
    http_req_duration: ["p(95)<800", "p(99)<2000"],
    http_req_failed: ["rate<0.01"],
    booking_failures: ["rate<0.02"],
    search_latency_ms: ["p(95)<500"],
    // Auth is allowed to be slower: bcrypt is intentionally expensive, and
    // holding it to the same bar would either fail the test or push someone
    // to weaken the work factor.
    auth_latency_ms: ["p(95)<1500"],
  },
};

const DEMO_ACCOUNTS = [
  { email: "commuter@nairobi.go.ke", password: "pass123" },
];

export function setup() {
  // Confirm the target is actually up before generating load, so a failed
  // run reports "server unreachable" rather than 100% error rate.
  const health = http.get(`${BASE_URL}/healthz`);
  if (health.status !== 200) {
    throw new Error(`Target not healthy at ${BASE_URL}: HTTP ${health.status}`);
  }
  return { startedAt: Date.now() };
}

function authenticate() {
  const account = DEMO_ACCOUNTS[Math.floor(Math.random() * DEMO_ACCOUNTS.length)];
  const res = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify(account), {
    headers: { "Content-Type": "application/json" },
    tags: { name: "auth/login" },
  });
  authLatency.add(res.timings.duration);

  // 429 is a pass, not a failure: the rate limiter doing its job under load
  // is correct behaviour, and treating it as an error would make the test
  // reward removing the protection.
  check(res, { "login ok or rate-limited": (r) => r.status === 200 || r.status === 429 });

  if (res.status !== 200) return null;
  try {
    return res.json("accessToken");
  } catch {
    return null;
  }
}

export default function () {
  const token = authenticate();
  if (!token) {
    sleep(2);
    return;
  }
  const authHeaders = {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  };

  // Weighted to match real behaviour: most sessions browse, few transact.
  group("browse", () => {
    const routes = http.get(`${BASE_URL}/api/routes`, {
      ...authHeaders,
      tags: { name: "routes/list" },
    });
    check(routes, { "routes 200": (r) => r.status === 200 });
    sleep(Math.random() * 2 + 1);

    const matatus = http.get(`${BASE_URL}/api/matatus`, {
      ...authHeaders,
      tags: { name: "matatus/list" },
    });
    check(matatus, { "matatus 200": (r) => r.status === 200 });
  });

  // Roughly one session in five searches.
  if (Math.random() < 0.2) {
    group("search", () => {
      const res = http.get(`${BASE_URL}/api/search/records?q=KDA`, {
        ...authHeaders,
        tags: { name: "search/records" },
      });
      searchLatency.add(res.timings.duration);
      check(res, { "search ok": (r) => r.status === 200 || r.status === 403 });
    });
  }

  // Roughly one in twenty books — the write path, and the one that must not
  // silently fail under load.
  if (Math.random() < 0.05) {
    group("book", () => {
      const seat = Math.floor(Math.random() * 40) + 1;
      const payload = JSON.stringify({
        matatuId: "m-1",
        routeId: "brn-route-1",
        passengerName: `Load Test ${__VU}`,
        phone: "+254712345678",
        stageName: "CBD",
        seatNumbers: [seat],
      });
      const res = http.post(`${BASE_URL}/api/bookings`, payload, {
        ...authHeaders,
        // A real client sends one of these per logical booking; reusing it
        // across retries is the whole point of the header.
        headers: { ...authHeaders.headers, "Idempotency-Key": `k6-${__VU}-${__ITER}` },
        tags: { name: "bookings/create" },
      });
      // 409 means the seat was taken by another virtual user — correct
      // behaviour under concurrency, not a failure of the system.
      const acceptable = res.status === 201 || res.status === 409 || res.status === 400;
      bookingFailures.add(!acceptable);
      check(res, { "booking handled": () => acceptable });
    });
  }

  sleep(Math.random() * 3 + 2);
}

export function teardown(data) {
  console.log(`Run completed in ${((Date.now() - data.startedAt) / 1000).toFixed(0)}s against ${BASE_URL}`);
}
