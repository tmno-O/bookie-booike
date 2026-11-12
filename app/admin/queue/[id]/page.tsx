import { serviceDate } from "@/contracts/common";
import QueueScreen from "../queue-screen";

export default async function QueueRequestPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ date?: string | string[] }>;
}) {
  const [{ id }, { date }] = await Promise.all([params, searchParams]);
  const parsed = serviceDate.safeParse(date);
  return <QueueScreen requestId={id} initialDate={parsed.success ? parsed.data : undefined} />;
}
