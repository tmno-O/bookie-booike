import DashboardScreen from "../../dashboard-screen";

// Staff-assisted booking: the add-booking dialog opens over the dashboard.
export const metadata = { title: "แอดมิน: เพิ่มการจอง" };

export default function NewBookingPage() {
  return <DashboardScreen addBooking />;
}
