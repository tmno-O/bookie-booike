import BookingsScreen from "./bookings-screen";

// My bookings (Figma "06 · การจองของฉัน", node 169:412)
export const metadata = { title: "การจองของฉัน" };

export default async function BookingsPage({ params }: { params: Promise<{ slug: string }> }) {
  return <BookingsScreen slug={(await params).slug} />;
}
