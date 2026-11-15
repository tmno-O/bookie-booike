"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Shell, shellStyles as s } from "../shell";
import { api, asFailure, loadCustomer } from "../flow";

type Venue = { opensAt: string | null; open: boolean; secondsUntilOpen: number };

const countdown = (total: number) => {
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
};

export default function WaitingScreen({ slug }: { slug: string }) {
  const router = useRouter();
  const [venue, setVenue] = useState<Venue>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loadCustomer()) router.replace(`/book/${slug}/details`);
  }, [router, slug]);

  useEffect(() => {
    let active = true;
    const load = () => api<Venue>("/venue").then((v) => active && setVenue(v)).catch((e) => active && setError(asFailure(e).message));
    void load();
    const timer = setInterval(load, 1000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  async function join() {
    const customer = loadCustomer();
    if (!customer) return router.replace(`/book/${slug}/details`);
    setBusy(true); setError("");
    try {
      const { requestId } = await api<{ requestId: string }>("/queue", { method: "POST", body: customer });
      router.push(`/book/${slug}/queue?r=${requestId}`);
    } catch (e) {
      setError(asFailure(e).message); setBusy(false);
    }
  }

  const open = venue?.open === true;
  return (
    <Shell slug={slug} back={`/book/${slug}/details`}
      cta={{ label: busy ? "กำลังเข้าคิว…" : "รับคิวจอง", onClick: join, disabled: !open || busy }}>
      <p className={s.eyebrow}>ขั้นตอน 2 จาก 4</p>
      <h1 className={s.title}>รอเวลาเปิดจอง</h1>
      <p className={s.subtitle}>เมื่อร้านเปิดจอง จึงส่งคำขอเข้าสู่คิวได้</p>
      <div className={`${s.card} ${open ? s.cardAccent : ""}`} style={{ marginTop: 57 }} aria-live="polite">
        <p className={s.cardLabel} style={{ fontSize: 12 }}>{open ? "สถานะ" : "ร้านจะเปิดรับจองใน"}</p>
        <p className={`${s.cardValue} ${open ? s.cardValueAccent : ""}`}>
          {!venue ? "กำลังโหลด…" : open ? "เปิดรับจองแล้ว" : venue.opensAt ? countdown(venue.secondsUntilOpen) : "ยังไม่มีคืนที่เปิดจอง"}
        </p>
      </div>
      {error && <p role="alert" className={s.error}>{error}</p>}
      <p className={s.note} style={{ padding: "202px 0 0" }}>กดยืนยันเมื่อเปิดจอง เพื่อรับลำดับคิว</p>
    </Shell>
  );
}
