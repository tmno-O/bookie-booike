export type ApiFailure = { code: string; message: string; status: number };

/** Call the mock API; throws ApiFailure on non-2xx. */
export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(`/api/mock${path}`, {
    method: init?.method ?? "GET",
    headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !path.startsWith("/line/") && typeof window !== "undefined") {
    // Not logged in: go to the mock LINE login for this venue
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- hard redirect from a non-component helper
    window.location.href = `${window.location.pathname.split("/").slice(0, 3).join("/")}/login`;
  }
  if (!response.ok) {
    throw { code: data.error?.code ?? "ERROR", message: data.error?.message ?? "เกิดข้อผิดพลาด", status: response.status } satisfies ApiFailure;
  }
  return data as T;
}

export const asFailure = (e: unknown): ApiFailure =>
  typeof e === "object" && e && "code" in e ? (e as ApiFailure) : { code: "NETWORK", message: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้", status: 0 };

export type Booking = {
  id: string; reference: string; name: string; phone: string;
  serviceDate: string; party: string; zoneName: string;
};

const KEY = "bookie.customer";
export const saveCustomer = (c: { name: string; phone: string }) => {
  try { sessionStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage unavailable */ }
};
export const loadCustomer = (): { name: string; phone: string } | null => {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? "null"); } catch { return null; }
};

export const partyLabel = (party: string) => `${party.replace("-", "–")} คน`;
export const thaiDate = (value: string) =>
  new Intl.DateTimeFormat("th-TH-u-ca-gregory", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));

export type LineUser = { userId: string; displayName: string };
