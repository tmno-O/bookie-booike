import { customerApi, customerVenueSlug } from "@/client/customer-api";
import { apiRequest, asFailure, realApiMode, type ApiInit } from "@/client/transport";
import { bookingLoginQuery } from "@/lib/booking-links";

export { asFailure, realApiMode };
export type { ApiFailure } from "@/client/transport";

export async function api<T>(path: string, init?: ApiInit): Promise<T> {
  try {
    if (realApiMode) return await customerApi<T>(path, init);
    const query = path === "/venue" ? `?slug=${encodeURIComponent(customerVenueSlug())}` : "";
    return await apiRequest<T>(`/api/mock${path}${query}`, init);
  } catch (error) {
    if (asFailure(error).status === 401 && !path.startsWith("/line/") && typeof window !== "undefined") {
      const parts = window.location.pathname.split("/");
      const date = new URLSearchParams(window.location.search).get("date") ?? undefined;
      const next = parts[3] === "confirmed" ? "bookings" : parts[3] === "details" && date ? "select" : parts[3];
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- redirect after session expiry
      window.location.href = `${parts.slice(0, 3).join("/")}/login${bookingLoginQuery(next, date)}`;
    }
    throw error;
  }
}

export type Booking = {
  id: string; reference: string; name: string; phone: string;
  serviceDate: string; party: string; zoneName: string;
  serviceTime?: string; venueName?: string; venueAddress?: string;
  cancellableUntil: string | null; canCancel: boolean;
  receipt: { reference: string; queueSeq: string | null; receivedAt: string; decidedAt: string | null; verifyCode: string } | null;
  status?: "confirmed" | "pending_allocation" | "pending" | "checked_in" | "cancelled";
};

export const bookingStatusLabel = {
  pending_allocation: "รอร้านจัดสรรโซน",
  pending: "รอร้านจัดสรรโซน",
  confirmed: "ยืนยันการจองแล้ว",
  checked_in: "เช็กอินแล้ว",
  cancelled: "ยกเลิกการจองแล้ว",
} satisfies Record<NonNullable<Booking["status"]>, string>;

type Contact = { name: string; phone: string };
const keyFor = (scope: string, key: string) => `bookie:${scope}:${key}`;
const contacts = new Map<string, Contact>();
export const saveCustomer = (scope: string, contact: Contact) => {
  contacts.set(scope, contact);
  try { sessionStorage.setItem(keyFor(scope, "contact"), JSON.stringify(contact)); } catch { /* storage unavailable */ }
};
export const loadCustomer = (scope: string): Contact | null => {
  try { return JSON.parse(sessionStorage.getItem(keyFor(scope, "contact")) ?? "null") ?? contacts.get(scope) ?? null; }
  catch { return contacts.get(scope) ?? null; }
};
export const clearCustomer = (scope: string) => {
  contacts.delete(scope);
  try { sessionStorage.removeItem(keyFor(scope, "contact")); } catch { /* storage unavailable */ }
};

export type BookingAttempt = { payload: string; id: string };
export const readAttempt = (scope: string): BookingAttempt | null => {
  try { return JSON.parse(sessionStorage.getItem(keyFor(scope, "attempt")) ?? "null"); } catch { return null; }
};
export const saveAttempt = (scope: string, attempt: BookingAttempt | null) => {
  try {
    if (attempt) sessionStorage.setItem(keyFor(scope, "attempt"), JSON.stringify(attempt));
    else sessionStorage.removeItem(keyFor(scope, "attempt"));
  } catch { /* storage unavailable */ }
};

export const partyLabel = (party: string) => `${party.replace("-", "–")} คน`;
export const thaiDate = (value: string) =>
  new Intl.DateTimeFormat("th-TH-u-ca-gregory", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));

export type LineUser = { userId: string; displayName: string };
