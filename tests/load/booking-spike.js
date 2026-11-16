// Use a local venue and one mock LINE customer per booking request.
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

const base = __ENV.BASE_URL || "http://localhost:3000";
const date = __ENV.SERVICE_DATE;
const run = __ENV.RUN_ID || Date.now().toString();
const venueId = "10000000-0000-4000-8000-000000000001";
const zoneId = __ENV.ZONE_ID || "20000000-0000-4000-8000-000000000002";
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
  if (!date) throw new Error("Set SERVICE_DATE to an bookable service date with one table left in the selected zone");
  const availability = http.get(`${base}/api/venues/${venueId}/availability?date=${date}&partyBucket=1-4`);
  if (availability.status !== 200 || !availability.json("zones").some((zone) => zone.id === zoneId && zone.available && zone.tablesLeft === 1)) {
    throw new Error("Use an open zone with exactly one eligible table");
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
    venueId, serviceDate: date, zoneId, partyBucket: "1-4", contactName: `Load test ${__VU}`, contactPhone: "0812345678",
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
      if (check(resultCode, { "rejected only because table was taken": (code) => code === "ZONE_FULL" })) {
        unavailable.add(1);
      }
      return;
    }
    sleep(0.25);
  }
  check(false, { "request reaches terminal state": (value) => value });
}
