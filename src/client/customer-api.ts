import { MOCK_LINE_ACCOUNTS } from "@/mock/line";
import { apiRequest, type ApiInit } from "./transport";

export function customerVenueSlug() {
  return decodeURIComponent(window.location.pathname.split("/")[2] ?? "");
}

export function customerApi<T>(path: string, init?: ApiInit): Promise<T> {
  switch (path) {
    case "/venue":
      return apiRequest(`/api/venues/by-slug/${encodeURIComponent(customerVenueSlug())}`, init);
    case "/line/accounts":
      return Promise.resolve({ accounts: MOCK_LINE_ACCOUNTS } as T);
    case "/line/login":
      return apiRequest("/api/session/line", {
        ...init, body: { ...init?.body as object, venueSlug: customerVenueSlug() },
      });
    case "/line/logout":
      return apiRequest("/api/session/logout", init);
    default:
      return apiRequest(`/api${path}`, init);
  }
}
