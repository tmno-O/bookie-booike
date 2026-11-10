import { Suspense } from "react";
import QueueScreen from "./queue-screen";

// Request status — in queue (Figma "03 · อยู่ในคิว", node 169:400)
export default async function QueuePage({ params }: { params: Promise<{ slug: string }> }) {
  return <Suspense><QueueScreen slug={(await params).slug} /></Suspense>;
}
