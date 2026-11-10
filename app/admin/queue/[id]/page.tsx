import QueueScreen from "../queue-screen";

// Request details dialog over the queue page.
export default async function QueueRequestPage({ params }: { params: Promise<{ id: string }> }) {
  return <QueueScreen requestId={(await params).id} />;
}
