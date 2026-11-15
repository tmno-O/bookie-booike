// Posts table bookings without a queue ticket, so the server under test must run with DIRECT_BOOKING_ENABLED=true
// (local only; production refuses to start with it).
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

const base = __ENV.BASE_URL || "http://localhost:3000";
const date = __ENV.SERVICE_DATE;
const run = __ENV.RUN_ID || Date.now().toString();
const venueId = "10000000-0000-4000-8000-000000000001";
const tableId = "30000000-0000-4000-8000-000000000002";
const confirmed = new Counter("confirmed_bookings");
const unavailable = new Counter("unavailable_bookings");

export const options = {
  scenarios: { spike: { executor: "per-vu-iterations", vus: 20, iterations: 1, maxDuration: "1m" } },
  thresholds: {
    checks: ["rate==1"],
    confirmed_bookings: ["count==1"],
    unavailable_bookings: ["count==19"],
  },
};

export function setup() {
  if (!date) throw new Error("Set SERVICE_DATE to an unbooked service date for table A2");
  const availability = http.get(`${base}/api/venues/${venueId}/availability?date=${date}`);
  if (availability.status !== 200 || !availability.json("tables").some((table) => table.id === tableId && table.available)) {
    throw new Error("Demo table A2 must be available before the load test");
  }
}

export default function contendForTable() {
  const headers = { "Content-Type": "application/json" };
  const login = http.post(`${base}/api/session/line`, JSON.stringify({
    venueSlug: "bookie-demo",
    idToken: `mock:k6-${run}-${__VU}:Load test ${__VU}`,
  }), { headers });
  if (!check(login, { "mock session created": (response) => response.status === 200 })) return;

  const submitted = http.post(`${base}/api/booking-requests`, JSON.stringify({
    venueId, serviceDate: date, tableId, partySize: 4,
  }), { headers: { ...headers, "Idempotency-Key": `k6-${run}-${__VU}` } });
  if (!check(submitted, { "request accepted": (response) => response.status === 202 })) return;

  const requestId = submitted.json("requestId");
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = http.get(`${base}/api/me/booking-requests/${requestId}`);
    if (!check(result, { "poll succeeded": (response) => response.status === 200 })) return;
    const { status, resultCode } = result.json();
    if (status === "confirmed") {
      confirmed.add(1);
      return;
    }
    if (status === "rejected") {
      if (check(resultCode, { "rejected only because table was taken": (code) => code === "TABLE_UNAVAILABLE" })) {
        unavailable.add(1);
      }
      return;
    }
    sleep(0.25);
  }
  check(false, { "request reaches terminal state": (value) => value });
}
