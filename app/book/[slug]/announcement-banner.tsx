"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { customerApi } from "@/client/customer-api";
import { apiRequest, realApiMode } from "@/client/transport";
import { deadlineText } from "./cancel-booking";

type Data = { announcements: { id: string; title: string; serviceDate: string; opensAt: string }[]; optedOut: boolean };
const call = <T,>(path: string, init?: Parameters<typeof apiRequest>[1]) =>
  realApiMode ? customerApi<T>(path, init) : apiRequest<T>(`/api/mock${path}`, init);

export function AnnouncementBanner({ slug }: { slug: string }) {
  const [data, setData] = useState<Data>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => call<Data>("/announcements").then(setData).catch(() => undefined), []);
  useEffect(() => { void load(); const timer = setInterval(load, 30_000); return () => clearInterval(timer); }, [load]);
  async function toggle() {
    if (!data) return;
    setBusy(true); setError("");
    try { await call("/announcements/opt-out", { method: "POST", body: { optOut: !data.optedOut } }); await load(); }
    catch { setError("บันทึกการรับข่าวไม่สำเร็จ กรุณาลองใหม่"); } finally { setBusy(false); }
  }
  if (!data) return null;
  return <aside aria-label="ข่าวรอบจองใหม่" style={{ paddingBlock: 16, borderBottom: "1px solid #ded8d1" }}>
    {data.announcements.map((a) => <p key={a.id} role="status"><Link href={`/book/${slug}/waiting`}>รอบใหม่: {a.title} · คืน {a.serviceDate} · เปิดจอง {deadlineText(a.opensAt)} น.</Link></p>)}
    <button type="button" disabled={busy} onClick={toggle} style={{ minHeight: 44 }}>{data.optedOut ? "เปิดรับข่าวรอบใหม่" : "ปิดรับข่าวรอบใหม่"}</button>
    {error && <p role="alert">{error}</p>}
  </aside>;
}
