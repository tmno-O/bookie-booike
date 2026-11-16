import { queueTicket } from "@/contracts/queue";
import { waitForBooking } from "./booking-result";
import { MOCK_LINE_ACCOUNTS } from "@/mock/line";
import { apiRequest, type ApiInit } from "./transport";

export function customerVenueSlug() {
  return decodeURIComponent(window.location.pathname.split("/")[2] ?? "");
}

export function cancelBooking(id: string) {
  return apiRequest(`/api/me/bookings/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}

async function venueId() {
  const { id } = await apiRequest<{ id: string }>(`/api/venues/by-slug/${encodeURIComponent(customerVenueSlug())}`);
  return id;
}

export async function customerApi<T>(path: string, init?: ApiInit): Promise<T> {
  switch (path) {
    case "/announcements": return apiRequest("/api/me/announcements", init);
    case "/announcements/opt-out": return apiRequest("/api/me/announcements/opt-out", init);
    case "/venue":
      return apiRequest(`/api/venues/by-slug/${encodeURIComponent(customerVenueSlug())}`, init);
    case "/queue":
      return apiRequest(`/api/venues/${await venueId()}/queue-tickets`, init);
    case "/floor-plan":
      return apiRequest(`/api/venues/${await venueId()}/floor-plan`, init);
    case "/bookings":
      return init?.method === "POST" ? bookZone(init) as Promise<T> : apiRequest("/api/me/bookings", init);
    case "/line/accounts":
      return { accounts: MOCK_LINE_ACCOUNTS } as T;
    case "/line/login":
      return apiRequest("/api/session/line", {
        ...init, body: { ...init?.body as object, venueSlug: customerVenueSlug() },
      });
    case "/line/logout":
      return apiRequest("/api/session/logout", init);
    default:
      if (path.startsWith("/queue/")) {
        const ticket = queueTicket.parse(await apiRequest(`/api/me/queue-tickets/${path.slice(7)}`, init));
        return { ...ticket, status: ticket.bookingId ? "booked" : ticket.status } as T;
      }
      if (path.startsWith("/availability?")) {
        const result = await apiRequest<{ nightOpen: boolean }>(`/api/venues/${await venueId()}${path}`, init);
        return { ...result, open: result.nightOpen } as T;
      }
      if (path.startsWith("/bookings?")) return apiRequest(`/api/me${path}`, init);
      if (path.startsWith("/bookings/")) {
        if (path.endsWith("/cancel")) return { booking: await cancelBooking(path.split("/")[2]) } as T;
        return { booking: await apiRequest(`/api/me${path}`, init) } as T;
      }
      return apiRequest(`/api${path}`, init);
  }
}

async function bookZone(init: ApiInit) {
  const { requestId: ticketId, serviceDate, party, zoneId } = init.body as {
    requestId: string; serviceDate: string; party: string; zoneId: string;
  };
  const { requestId } = await apiRequest<{ requestId: string }>("/api/booking-requests", {
    method: "POST", signal: init.signal, idempotencyKey: ticketId,
    body: { venueId: await venueId(), ticketId, serviceDate, partyBucket: party, zoneId },
  });
  return waitForBooking(`/api/me/booking-requests/${requestId}`, init.signal, true);
}
