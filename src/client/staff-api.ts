import type { z } from "zod";
import type { booking } from "@/contracts/booking";
import { bangkokDate } from "@/lib/service-date";
import type { zoneView } from "@/contracts/venue";
import type { dashboardData, staffProfile } from "@/contracts/staff";
import { waitForBooking } from "./booking-result";
import { apiRequest, realApiMode, type ApiInit } from "./transport";

type StaffProfile = z.infer<typeof staffProfile>;
type StaffBooking = z.infer<typeof booking> & { canCheckIn?: boolean };

function viewBooking(entry: StaffBooking) {
  return {
    ...entry,
    status: entry.status === "pending_allocation" ? "pending" : entry.status,
    channel: entry.source === "liff" ? "line" : "staff",
  };
}

function viewZone(zone: z.infer<typeof zoneView>) {
  return { ...zone, status: zone.status === "active" ? "open" : zone.status };
}

let profileRequest: Promise<StaffProfile> | undefined;

function getProfile() {
  return profileRequest ??= apiRequest<StaffProfile>("/api/staff/me").finally(() => { profileRequest = undefined; });
}

export async function staffApi<T>(path: string, init?: ApiInit): Promise<T> {
  switch (path) {
    case "/admin/login": return apiRequest("/api/staff/session", init);
    case "/admin/logout": return apiRequest("/api/staff/session/logout", init);
    case "/admin/me": return getProfile() as Promise<T>;
  }

  const { venue } = await getProfile();
  if (path === "/venue") return apiRequest(`/api/venues/by-slug/${encodeURIComponent(venue.slug)}`, init);
  const base = `/api/staff/venues/${venue.id}`;
  const endpoint = `${base}${path.replace(/^\/admin(?=\/)/, "")}`;
  if (path.endsWith("/timeline")) return apiRequest(endpoint, init);
  if (path === "/admin/bookings" && init?.method === "POST") {
    const { requestId } = await apiRequest<{ requestId: string }>(`${base}/booking-requests`, init);
    const { booking } = await waitForBooking(`${base}/booking-requests/${requestId}`, init.signal);
    return { booking: viewBooking(await apiRequest<StaffBooking>(`${base}/bookings/${booking.id}`)) } as T;
  }
  if (path.startsWith("/admin/dashboard")) {
    const result = await apiRequest<z.infer<typeof dashboardData>>(endpoint, init);
    return { ...result, bookings: result.bookings.map(viewBooking) } as T;
  }
  if (path.startsWith("/admin/bookings?")) {
    const params = new URLSearchParams(path.split("?")[1]);
    if (!params.has("date")) params.set("date", bangkokDate());
    const result = await apiRequest<{ serviceDate: string; bookings: StaffBooking[]; nextOffset: number | null }>(
      `/api/staff/venues/${venue.id}/bookings?${params}`, init,
    );
    return { ...result, bookings: result.bookings.map(viewBooking) } as T;
  }
  if (path.startsWith("/admin/bookings/")) {
    return { booking: viewBooking(await apiRequest<StaffBooking>(endpoint, init)) } as T;
  }
  if (path === "/admin/zones" && (!init?.method || init.method === "GET")) {
    const result = await apiRequest<{ zones: z.infer<typeof zoneView>[] }>(endpoint, init);
    return { ...result, zones: result.zones.map(viewZone) } as T;
  }
  if (path === "/admin/zones" || path.startsWith("/admin/zones/")) {
    return { zone: viewZone(await apiRequest<z.infer<typeof zoneView>>(endpoint, init)) } as T;
  }
  return apiRequest(endpoint, init);
}

export async function exportAuditCsv(query: string) {
  const endpoint = realApiMode
    ? `/api/staff/venues/${(await getProfile()).venue.id}/audit/export.csv?${query}`
    : `/api/mock/admin/audit/export.csv?${query}`;
  const response = await fetch(endpoint, { cache: "no-store" });
  if (!response.ok) throw new Error("ส่งออกหลักฐานไม่สำเร็จ");
  return response.blob();
}
