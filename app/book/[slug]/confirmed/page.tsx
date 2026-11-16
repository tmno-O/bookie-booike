import { Suspense } from "react";
import ConfirmedScreen from "./confirmed-screen";

// Booking confirmed (Figma "05 · ยืนยันการจอง", node 169:406)
export const metadata = { title: "จองสำเร็จ" };

export default async function ConfirmedPage({ params }: { params: Promise<{ slug: string }> }) {
  return <Suspense><ConfirmedScreen slug={(await params).slug} /></Suspense>;
}
