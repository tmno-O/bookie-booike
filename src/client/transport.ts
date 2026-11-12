export const realApiMode = process.env.NEXT_PUBLIC_API_MODE === "real";

export type ApiFailure = { code: string; message: string; status: number; ticketUsed?: boolean };
export type ApiInit = { method?: string; body?: unknown; idempotencyKey?: string; signal?: AbortSignal };

export async function apiRequest<T>(path: string, init?: ApiInit): Promise<T> {
  const response = await fetch(path, {
    method: init?.method ?? "GET",
    headers: {
      ...(init?.body !== undefined && { "Content-Type": "application/json" }),
      ...(init?.idempotencyKey && { "Idempotency-Key": init.idempotencyKey }),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init?.signal,
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw {
      code: data.error?.code ?? "ERROR",
      message: data.error?.message ?? "เกิดข้อผิดพลาด",
      status: response.status,
    } satisfies ApiFailure;
  }
  return data as T;
}

export const asFailure = (error: unknown): ApiFailure =>
  typeof error === "object" && error && "status" in error
    ? error as ApiFailure
    : { code: "NETWORK", message: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้", status: 0 };
