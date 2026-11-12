import { MOCK_LINE_ACCOUNTS } from "@/mock/line";
import { apiRequest, type ApiInit } from "./transport";

export function customerVenueSlug() {
  return decodeURIComponent(window.location.pathname.split("/")[2] ?? "");
}

async function venueId() {
  const { id } = await apiRequest<{ id: string }>(`/api/venues/by-slug/${encodeURIComponent(customerVenueSlug())}`);
  return id;
}

export async function customerApi<T>(path: string, init?: ApiInit): Promise<T> {
  switch (path) {
    case "/venue":
      return apiRequest(`/api/venues/by-slug/${encodeURIComponent(customerVenueSlug())}`, init);
    case "/queue":
      return apiRequest(`/api/venues/${await venueId()}/queue-tickets`, init);
    case "/line/accounts":
      return { accounts: MOCK_LINE_ACCOUNTS } as T;
    case "/line/login":
      return apiRequest("/api/session/line", {
        ...init, body: { ...init?.body as object, venueSlug: customerVenueSlug() },
      });
    case "/line/logout":
      return apiRequest("/api/session/logout", init);
    default:
      if (path.startsWith("/queue/")) return apiRequest(`/api/me/queue-tickets/${path.slice(7)}`, init);
      return apiRequest(`/api${path}`, init);
  }
}
