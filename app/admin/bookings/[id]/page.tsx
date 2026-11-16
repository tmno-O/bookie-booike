import BookingsListScreen from "../bookings-screen";
import DashboardScreen from "../../dashboard-screen";

// Booking details dialog over the dashboard, or over the booking list when opened from it.
export const metadata = { title: "แอดมิน: รายละเอียดการจอง" };

export default async function BookingDetailsPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; date?: string }>;
}) {
  const { id } = await params;
  const { from, date } = await searchParams;
  if (from === "list") {
    return <BookingsListScreen bookingId={id} initialDate={date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined} />;
  }
  return <DashboardScreen bookingId={id} />;
}
