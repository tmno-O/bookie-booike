"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Shell, shellStyles as s } from "../shell";
import { api, asFailure } from "../flow";

type Status = { status: "waiting" | "ready" | "booked" | "used" | "expired"; position: number; bookingId: string | null };

export default function QueueScreen({ slug }: { slug: string }) {
  const router = useRouter();
  const requestId = useSearchParams().get("r");
  const [state, setState] = useState<Status>();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!requestId) { router.replace(`/book/${slug}/waiting`); return; }
    let active = true;
    const load = () => api<Status>(`/queue/${requestId}`).then((v) => {
      if (!active) return;
      if (v.status === "expired") router.replace(`/book/${slug}/waiting`);
      else setState(v);
    }).catch((e) => {
      if (!active) return;
      if (asFailure(e).status === 404) router.replace(`/book/${slug}/waiting`);
      else setError(asFailure(e).message);
    });
    void load();
    const timer = setInterval(load, 1000);
    return () => { active = false; clearInterval(timer); };
  }, [requestId, router, slug]);

  const ready = state?.status === "ready";
  const booked = state?.status === "booked" && state.bookingId;
  return (
    <Shell slug={slug} back={`/book/${slug}/waiting`}
      cta={booked
        ? { label: "ดูการจองของฉัน", href: `/book/${slug}/confirmed?b=${state.bookingId}` }
        : { label: ready ? "ถึงคิวแล้ว · เลือกข้อมูลการจอง" : "รอถึงคิวของคุณ", href: `/book/${slug}/select?r=${requestId}`, disabled: !ready }}>
      <p className={s.eyebrow}>สถานะคำขอ</p>
      <h1 className={s.title}>{ready ? "ถึงคิวของคุณแล้ว" : "คำขออยู่ในคิว"}</h1>
      <p className={s.subtitle}>เมื่อถึงคิว จึงเลือกคืน จำนวนคน และโซน</p>
      <div className={s.card} style={{ marginTop: 57 }} aria-live="polite">
        <p className={s.cardLabel}>ลำดับคิว</p>
        <p className={s.cardValue}>{state ? state.position : "…"}</p>
      </div>
      {error && <p role="alert" className={s.error}>{error}</p>}
    </Shell>
  );
}
