import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata = { title: "เข้าสู่ระบบ" };

export default function Home() {
  const slug = process.env.DEFAULT_VENUE_SLUG || "bookie-demo";
  redirect(`/book/${encodeURIComponent(slug)}/login`);
}
