import BookingsListScreen from "./bookings-screen";

export const metadata = { title: "แอดมิน: การจอง" };

export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  return <BookingsListScreen initialDate={date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined} />;
}
