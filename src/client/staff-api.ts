import type { z } from "zod";
import type { staffProfile } from "@/contracts/staff";
import { apiRequest, type ApiInit } from "./transport";

type StaffProfile = z.infer<typeof staffProfile>;
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
  if (path.startsWith("/availability?")) return apiRequest(`/api/venues/${venue.id}${path}`, init);
  return apiRequest(`/api/staff/venues/${venue.id}${path.replace(/^\/admin(?=\/)/, "")}`, init);
}
