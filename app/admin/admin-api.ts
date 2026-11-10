export type Staff = { email: string; displayName: string; role: "owner" | "staff" };
export type Failure = { code: string; message: string; status: number };

export async function adminApi<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(`/api/mock${path}`, {
    method: init?.method ?? "GET",
    headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw { code: data.error?.code ?? "ERROR", message: data.error?.message ?? "เกิดข้อผิดพลาด", status: response.status } satisfies Failure;
  }
  return data as T;
}

export const asFailure = (e: unknown): Failure =>
  typeof e === "object" && e && "status" in e ? (e as Failure) : { code: "NETWORK", message: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้", status: 0 };

export const PARTY_LABEL: Record<string, string> = { "1-4": "1–4 คน", "5-8": "5–8 คน", "9-12": "9–12 คน", "12+": "12+ คน" };
export const STATUS_LABEL = { pending: "รอจัดสรร", confirmed: "ยืนยันแล้ว", checked_in: "เช็กอินแล้ว" } as const;
export const CHANNEL_LABEL = { line: "LINE", staff: "จองโดยร้าน" } as const;

export const formatPhone = (p: string) => p.length === 10 ? `${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}` : p;
export const shortThaiDate = (value: string) =>
  new Intl.DateTimeFormat("th-TH-u-ca-gregory", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));

export const queueDate = (value: string) =>
  new Intl.DateTimeFormat("th-TH-u-ca-gregory", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
export const clockTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Bangkok" })
    .format(new Date(iso));
