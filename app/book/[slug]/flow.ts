import { customerApi } from "@/client/customer-api";
import { apiRequest, asFailure, realApiMode, type ApiInit } from "@/client/transport";

export { asFailure, realApiMode };
export type { ApiFailure } from "@/client/transport";

export async function api<T>(path: string, init?: ApiInit): Promise<T> {
  try {
    return await (realApiMode ? customerApi<T>(path, init) : apiRequest<T>(`/api/mock${path}`, init));
  } catch (error) {
    if (asFailure(error).status === 401 && !path.startsWith("/line/") && typeof window !== "undefined") {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- redirect after session expiry
      window.location.href = `${window.location.pathname.split("/").slice(0, 3).join("/")}/login`;
    }
    throw error;
  }
}

export type Booking = {
  id: string; reference: string; name: string; phone: string;
  serviceDate: string; party: string; zoneName: string;
  status?: "confirmed" | "pending_allocation" | "pending" | "checked_in" | "cancelled";
};

export const bookingStatusLabel = {
  pending_allocation: "รอร้านจัดสรรโซน",
  pending: "รอร้านจัดสรรโซน",
  confirmed: "ยืนยันการจองแล้ว",
  checked_in: "เช็กอินแล้ว",
  cancelled: "ยกเลิกการจองแล้ว",
} satisfies Record<NonNullable<Booking["status"]>, string>;

const KEY = "bookie.customer";
export const saveCustomer = (c: { name: string; phone: string }) => {
  try { sessionStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage unavailable */ }
};
export const loadCustomer = (): { name: string; phone: string } | null => {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? "null"); } catch { return null; }
};

export const partyLabel = (party: string) => `${party.replace("-", "–")} คน`;
export const thaiDate = (value: string) =>
  new Intl.DateTimeFormat("th-TH-u-ca-gregory", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));

export type LineUser = { userId: string; displayName: string };
