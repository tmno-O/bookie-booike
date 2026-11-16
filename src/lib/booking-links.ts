import { serviceDate } from "@/contracts/common";

export type BookingDestination = "bookings" | "select";

export function bookingPath(slug: string, page: BookingDestination | "details", date?: string) {
  return `/book/${encodeURIComponent(slug)}/${page}${date ? `?date=${encodeURIComponent(date)}` : ""}`;
}

function readDestination(search: string): { page?: BookingDestination; date?: string } {
  const params = new URLSearchParams(search);
  const page = params.get("next");
  if (page !== "bookings" && page !== "select") return {};
  return { page, date: page === "select" ? serviceDate.safeParse(params.get("date")).data : undefined };
}

export function bookingLoginQuery(page?: string, date?: string) {
  if (page !== "bookings" && page !== "select") return "";
  const params = new URLSearchParams({ next: page });
  const parsed = serviceDate.safeParse(date);
  if (page === "select" && parsed.success) params.set("date", parsed.data);
  return `?${params}`;
}

export function bookingAfterLogin(slug: string, search: string) {
  const { page, date } = readDestination(search);
  return bookingPath(slug, page ?? "details", date);
}

export function safeBookingLoginQuery(search: string) {
  const { page, date } = readDestination(search);
  return bookingLoginQuery(page, date);
}
