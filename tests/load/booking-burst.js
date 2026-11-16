// Use a local venue and one mock LINE customer per booking request.
import http from "k6/http";
import { Counter } from "k6/metrics";

function integer(name, fallback, max) {
  const value = Number(__ENV[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }
  return value;
}

const count = integer("BOOKING_REQUESTS", 5000, 5000);
const parallel = integer("MAX_IN_FLIGHT", count, count);
const base = __ENV.BASE_URL || "http://localhost:3100";
const slug = __ENV.VENUE_SLUG || "bookie-demo";
const zoneId = __ENV.ZONE_ID || "20000000-0000-4000-8000-000000000002";
const date = __ENV.SERVICE_DATE;
const runId = __ENV.RUN_ID;
const contentType = { "Content-Type": "application/json" };
const submitted = new Counter("booking_posts");
const accepted = new Counter("booking_accepted");

export const options = {
  batch: parallel,
  batchPerHost: parallel,
  setupTimeout: "10m",
  scenarios: { burst: { executor: "shared-iterations", vus: 1, iterations: 1, maxDuration: "10m" } },
  thresholds: {
    booking_posts: [`count==${count}`],
    booking_accepted: [`count==${count}`],
    "http_req_duration{phase:booking}": [],
  },
};

export function setup() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) throw new Error("Set SERVICE_DATE to an unbooked service date");
  if (!/^[A-Za-z0-9]{1,40}$/.test(runId ?? "")) throw new Error("Set RUN_ID to a new alphanumeric identifier");

  const venue = http.get(`${base}/api/venues/by-slug/${encodeURIComponent(slug)}`);
  if (venue.status !== 200 || venue.json("allocationMode") !== "auto") {
    throw new Error("Use a local test venue with automatic allocation");
  }
  const venueId = venue.json("id");
  const availability = http.get(`${base}/api/venues/${venueId}/availability?date=${date}&partyBucket=1-4`);
  if (availability.status !== 200 || !availability.json("zones").some((zone) => zone.id === zoneId && zone.available && zone.tablesLeft === 1)) {
    throw new Error("Use an open zone with exactly one eligible table");
  }

  const sessions = [];
  const sessionCount = count;
  for (let offset = 0; offset < sessionCount; offset += 10) {
    const logins = Array.from({ length: Math.min(10, sessionCount - offset) }, (_, index) => ({
      method: "POST",
      url: `${base}/api/session/line`,
      body: JSON.stringify({ venueSlug: slug, idToken: `mock:burst-${runId}-${offset + index}:Burst test` }),
      // Login revokes the previous session cookie. Give each account its own jar.
      params: { headers: contentType, jar: new http.CookieJar(), tags: { phase: "setup" } },
    }));
    for (const response of http.batch(logins)) {
      const session = response.cookies.bookie_session?.[0]?.value;
      if (response.status !== 200 || !session) throw new Error(`Mock login failed with HTTP ${response.status}`);
      sessions.push(session);
    }
  }
  return { venueId, sessions };
}

export default function submitBurst({ venueId, sessions }) {
  const body = JSON.stringify({ venueId, serviceDate: date, zoneId, partyBucket: "1-4", contactName: "Burst test", contactPhone: "0812345678" });
  const requests = Array.from({ length: count }, (_, index) => ({
    method: "POST",
    url: `${base}/api/booking-requests`,
    body,
    params: {
      headers: { ...contentType, "Idempotency-Key": `burst-${runId}-${index}` },
      cookies: { bookie_session: { value: sessions[index], replace: true } },
      tags: { phase: "booking" },
      timeout: "90s",
    },
  }));
  const byStatus = {};
  const responses = http.batch(requests);
  for (const response of responses) {
    const status = String(response.status);
    byStatus[status] = (byStatus[status] || 0) + 1;
  }
  submitted.add(responses.length);
  accepted.add(byStatus[202] || 0);
  console.log(JSON.stringify({ runId, venueId, serviceDate: date, maxInFlight: parallel, byStatus }));
}
