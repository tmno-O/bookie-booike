"use client";

import Script from "next/script";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { z } from "zod";
import { requestAccepted, requestStatus } from "@/contracts/booking";
import { availability, venuePublic } from "@/contracts/venue";

type Liff = {
  init: (options: { liffId: string }) => Promise<void>;
  isLoggedIn: () => boolean;
  login: (options: { redirectUri: string }) => void;
  getIDToken: () => string | null;
};
type Venue = z.infer<typeof venuePublic>;
type Table = z.infer<typeof availability>["tables"][number];

async function api(path: string, method = "GET", payload?: unknown, key?: string) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(payload !== undefined && { "Content-Type": "application/json" }),
      ...(key && { "Idempotency-Key": key }),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? "เกิดข้อผิดพลาด");
  return data;
}

export default function BookingDemo({ slug, mock }: { slug: string; mock: boolean }) {
  const [venue, setVenue] = useState<Venue>();
  const [tables, setTables] = useState<Table[]>([]);
  const [date, setDate] = useState("");
  const [target, setTarget] = useState("");
  const [partySize, setPartySize] = useState(2);
  const [subject, setSubject] = useState("demo-guest");
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [liff, setLiff] = useState<Liff>();
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const initialized = useRef<{ id: string; ready: Promise<void> } | null>(null);

  useEffect(() => {
    let active = true;
    void api(`/venues/by-slug/${encodeURIComponent(slug)}`).then((data) => {
      if (!active) return;
      const current = venuePublic.parse(data);
      setVenue(current);
      setDate(new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: current.timezone }).format(new Date()));
    }).catch((error: Error) => { if (active) setStatus(error.message); });
    return () => { active = false; };
  }, [slug]);

  useEffect(() => {
    if (!venue || !date) return;
    let active = true;
    void api(`/venues/${venue.id}/availability?date=${date}`).then((data) => {
      if (active) setTables(availability.parse(data).tables);
    }).catch((error: Error) => { if (active) setStatus(error.message); });
    return () => { active = false; };
  }, [venue, date, refresh]);

  useEffect(() => {
    if (mock || !sdkLoaded || !venue?.liffId) return;
    const sdk = (window as Window & { liff?: Liff }).liff;
    if (!sdk) return;
    let active = true;
    if (initialized.current?.id !== venue.liffId) {
      initialized.current = { id: venue.liffId, ready: sdk.init({ liffId: venue.liffId }) };
    }
    void initialized.current.ready.then(async () => {
      if (!active) return;
      if (sdk.isLoggedIn()) {
        const idToken = sdk.getIDToken();
        if (!idToken) throw new Error("LINE ไม่ได้ส่ง ID token");
        const session = await api("/session/line", "POST", { venueSlug: slug, idToken });
        if (active) setDisplayName(session.displayName);
      }
      if (active) setLiff(sdk);
    }).catch((error: Error) => { if (active) setStatus(error.message); });
    return () => { active = false; };
  }, [mock, sdkLoaded, slug, venue]);

  const auto = venue?.tableSelectionMode === "auto_assign";
  const available = tables.filter((table) => table.available && table.capacity >= partySize);
  const options = auto
    ? [...new Map(available.map((table) => [table.zoneId, table.zoneName]))]
    : available.map((table) => [table.id, `${table.zoneName} / ${table.name} (${table.capacity} ที่)`]);

  async function login() {
    if (!mock) {
      liff?.login({ redirectUri: `${window.location.origin}${window.location.pathname}` });
      return;
    }
    setBusy(true);
    try {
      const session = await api("/session/line", "POST", { venueSlug: slug, idToken: `mock:${subject}:${subject}` });
      setDisplayName(session.displayName);
      setStatus("");
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!venue || !options.some(([id]) => id === target)) return;
    setBusy(true);
    setBookingId(null);
    const payload = {
      venueId: venue.id, serviceDate: date, partySize, ...(auto ? { zoneId: target } : { tableId: target }),
    };
    const serialized = JSON.stringify(payload);
    if (attempt.current?.payload !== serialized) attempt.current = { payload: serialized, key: crypto.randomUUID() };
    try {
      const { requestId } = requestAccepted.parse(await api("/booking-requests", "POST", payload, attempt.current.key));
      setStatus(`เข้าคิวแล้ว · ${requestId}`);
      for (let index = 0; index < 30; index++) {
        const result = requestStatus.parse(await api(`/me/booking-requests/${requestId}`));
        if (result.status === "confirmed" || result.status === "rejected") {
          setBookingId(result.bookingId);
          setStatus(result.status === "confirmed" ? "ยืนยันการจองแล้ว" : `จองไม่สำเร็จ · ${result.resultCode}`);
          attempt.current = null;
          setRefresh((value) => value + 1);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      setStatus("คำขอยังอยู่ในคิว กดจองอีกครั้งเพื่อตรวจคำขอเดิม");
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await api(`/me/bookings/${bookingId}/cancel`, "POST");
      setBookingId(null);
      setRefresh((value) => value + 1);
      setStatus("ยกเลิกการจองแล้ว");
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <>
    {!mock && <Script src="https://static.line-scdn.net/liff/edge/versions/2.32.0/sdk.js" onReady={() => setSdkLoaded(true)} />}
    <h1>{venue?.name ?? "Bookie Bookie"}</h1>
    {venue?.description && <p>{venue.description}</p>}
    {!displayName && <>
      {mock && <p><label>ชื่อผู้ใช้ทดสอบ <input value={subject} onChange={(event) => setSubject(event.target.value)} /></label></p>}
      <button disabled={busy || !venue || (!mock && !liff)} onClick={login}>{mock ? "เข้าสู่ระบบทดสอบ" : "เข้าสู่ระบบ LINE"}</button>
    </>}
    {displayName && <form onSubmit={submit}>
      <p>ผู้จอง {displayName}</p>
      <p><label>คืนบริการ <input type="date" required value={date} onChange={(event) => {
        setDate(event.target.value); setTables([]); setTarget("");
      }} /></label></p>
      <p><label>จำนวนคน <input type="number" min="1" max="1000" required value={partySize}
        onChange={(event) => { setPartySize(Number(event.target.value)); setTarget(""); }} /></label></p>
      <p><label>{auto ? "โซน" : "โต๊ะ"} <select required value={target} onChange={(event) => setTarget(event.target.value)}>
        <option value="">{options.length ? "เลือก" : "ไม่มีตัวเลือกว่าง"}</option>
        {options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label></p>
      <button disabled={busy || !target}>ส่งคำขอจอง</button>
    </form>}
    <p role="status">{status}</p>
    {bookingId && <button disabled={busy} onClick={cancel}>ยกเลิกการจอง</button>}
  </>;
}
