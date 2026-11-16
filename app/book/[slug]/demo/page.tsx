import { redirect } from "next/navigation";

export default async function LegacyBookingPage({ params }: { params: Promise<{ slug: string }> }) {
  redirect(`/book/${encodeURIComponent((await params).slug)}/select`);
}
