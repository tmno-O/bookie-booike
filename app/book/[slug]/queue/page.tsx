import { Shell, shellStyles as s } from "../shell";

// Request status — in queue (Figma "03 · อยู่ในคิว", node 169:400)
export default async function QueuePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Shell slug={slug} back={`/book/${slug}/waiting`} cta={{ href: `/book/${slug}/select`, label: "ถึงคิวแล้ว · เลือกข้อมูลการจอง" }}>
      <p className={s.eyebrow}>สถานะคำขอ</p>
      <h1 className={s.title}>คำขออยู่ในคิว</h1>
      <p className={s.subtitle}>เมื่อถึงคิว จึงเลือกคืน จำนวนคน และโซน</p>
      {/* Sample position — not yet read from /api/me/booking-requests/{id} */}
      <div className={s.card} style={{ marginTop: 57 }}>
        <p className={s.cardLabel}>ลำดับคิวตัวอย่าง</p>
        <p className={s.cardValue}>12</p>
      </div>
    </Shell>
  );
}
