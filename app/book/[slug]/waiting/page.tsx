import { Shell, shellStyles as s } from "../shell";

// Step 2 of 4 — waiting for booking to open (Figma "02 · รอเวลาเปิดจอง", node 169:394)
export default async function WaitingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Shell slug={slug} back={`/book/${slug}/details`} cta={{ href: `/book/${slug}/queue`, label: "รับคิวจอง" }}>
      <p className={s.eyebrow}>ขั้นตอน 2 จาก 4</p>
      <h1 className={s.title}>รอเวลาเปิดจอง</h1>
      <p className={s.subtitle}>เมื่อร้านเปิดจอง จึงส่งคำขอเข้าสู่คิวได้</p>
      {/* Sample status — not yet read from /api/venues/{id}/releases */}
      <div className={`${s.card} ${s.cardAccent}`} style={{ marginTop: 57 }}>
        <p className={s.cardLabel} style={{ fontSize: 12 }}>สถานะตัวอย่าง</p>
        <p className={`${s.cardValue} ${s.cardValueAccent}`}>เปิดรับจองแล้ว</p>
      </div>
      <p className={s.note} style={{ padding: "202px 0 0" }}>กดยืนยันเมื่อเปิดจอง เพื่อรับลำดับคิว</p>
    </Shell>
  );
}
