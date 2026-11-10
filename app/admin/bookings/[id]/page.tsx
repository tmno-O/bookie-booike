import DashboardScreen from "../../dashboard-screen";

// Booking details dialog over the dashboard.
export default async function BookingDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  return <DashboardScreen bookingId={(await params).id} />;
}
