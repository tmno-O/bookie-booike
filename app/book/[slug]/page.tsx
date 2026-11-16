import { redirect } from "next/navigation";

export const metadata = { title: "เข้าสู่ระบบ" };

export default async function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/book/${encodeURIComponent(slug)}/login`);
}
