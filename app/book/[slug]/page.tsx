import { redirect } from "next/navigation";

export default async function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/book/${encodeURIComponent(slug)}/login`);
}
