import { serviceDate } from "@/contracts/common";
import QueueScreen from "./queue-screen";

export const metadata = { title: "แอดมิน: คิวจัดโต๊ะ" };

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ date?: string | string[] }> }) {
  const date = serviceDate.safeParse((await searchParams).date);
  return <QueueScreen initialDate={date.success ? date.data : undefined} />;
}
