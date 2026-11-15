import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FloorPlan } from "@/lib/floor-plan";

// Mock JSON "database" for local end-to-end testing. Single-process only:
// writes are serialised with an in-memory lock and saved atomically to one JSON file.

export type Zone = { id: string; name: string; seats: number; status: "open" | "closed" };
/** A zone holds one booking per table; one table seats 12 people. */
export const TABLE_SEATS = 12;
export const tablesFor = (zone: Zone) => Math.max(1, Math.ceil(zone.seats / TABLE_SEATS));
export type QueueEntry = {
  id: string; customerId: string; name: string; phone: string;
  createdAt: string; startPosition: number; bookingId: string | null;
};
export type Booking = {
  id: string; reference: string; requestId: string; customerId: string; name: string; phone: string;
  serviceDate: string; party: string; zoneId: string; zoneName: string; createdAt: string;
  status: BookingStatus; channel: "line" | "staff"; checkedInAt?: string; cancelledAt?: string;
  /** Queue request number and when it was sent (customer requests only). */
  queueNo?: number; requestedAt?: string;
};
export type BookingStatus = "pending" | "confirmed" | "checked_in" | "cancelled";
export type LineUser = { id: string; userId: string; displayName: string; createdAt: string };
export type SpecialDay = { id: string; serviceDate: string; opensOn: string; time: string };
export type Schedule = { standard: { daysBefore: number; time: string }; specials: SpecialDay[];
  openWeekdays: number[]; closures: { serviceDate: string; reason: string }[] };
export const DEFAULT_SCHEDULE: Schedule = { standard: { daysBefore: 1, time: "20:00" }, specials: [],
  openWeekdays: [0,1,2,3,4,5,6], closures: [] };
export type ShopProfile = { name: string; phone: string; address: string; entryPolicy: string };
export const DEFAULT_PROFILE: ShopProfile = {
  name: "ร้านตัวอย่าง", phone: "02 123 4567", address: "เชียงใหม่ ประเทศไทย", entryPolicy: "กรุณามาถึงตามเวลาที่ร้านกำหนด",
};
export type Invite = { id: string; email: string; role: "staff"; createdAt: string };
export type Db = {
  venue: {
    slug: string; name: string; timezone: string; queueStepSeconds: number; maxAdvanceDays: number;
    /** Test hook: customers cannot join the queue before this instant (reset with opensInSeconds). */
    holdUntil: string;
    schedule: Schedule;
  };
  zones: Zone[];
  lineUsers: LineUser[];
  profile: ShopProfile;
  cancellation: { customerCancelEnabled: boolean; cancelCutoffMinutes: number };
  invites: Invite[];
  floorPlan: { draft: FloorPlan | null; published: FloorPlan | null; publishedAt: string | null };
  queue: QueueEntry[];
  bookings: Booking[];
  seq: number;
};

export const PARTIES = ["1-4", "5-8", "9-12", "12+"] as const;
/** Rough headcount per party bucket, used for dashboard guest totals and zone seat usage. */
export const PARTY_SIZE: Record<string, number> = { "1-4": 4, "5-8": 8, "9-12": 12, "12+": 15 };
export const QUEUE_AHEAD = 11; // people already waiting in front of the first customer
const TZ = "Asia/Bangkok";

export const today = (now = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: TZ }).format(now);
export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function seed(opts: { opensInSeconds?: number; queueStepSeconds?: number } = {}): Db {
  const now = new Date();
  const day = today(now);
  const zones: Zone[] = [
    { id: "zone-vip", name: "VIP", seats: 24, status: "open" },
    { id: "zone-indoor", name: "Indoor", seats: 48, status: "open" },
    { id: "zone-outdoor", name: "Outdoor", seats: 60, status: "open" },
  ];
  const [vip, indoor, outdoor] = zones;
  const at = (time: string) => new Date(`${day}T${time}+07:00`).toISOString();
  const existing = (seq: number, name: string, phone: string, party: string, zone: Zone,
    status: BookingStatus, channel: "line" | "staff", queueNo?: number, time = "20:00:00"): Booking => ({
    id: `seed-${seq}`, reference: `BL-${day.slice(0, 4)}-${String(seq).padStart(4, "0")}`, requestId: `seed-req-${seq}`,
    customerId: `seed-customer-${seq}`, name, phone, serviceDate: day, party,
    zoneId: zone.id, zoneName: zone.name, createdAt: at(time), status, channel,
    ...(queueNo && { queueNo, requestedAt: at(time) }),
  });
  return {
    venue: {
      slug: "bookie-demo", name: "Bookie lyon.", timezone: TZ, maxAdvanceDays: 6,
      holdUntil: new Date(now.getTime() + (opts.opensInSeconds ?? 0) * 1000).toISOString(),
      schedule: structuredClone(DEFAULT_SCHEDULE),
      queueStepSeconds: opts.queueStepSeconds ?? 2,
    },
    zones,
    lineUsers: [],
    profile: { ...DEFAULT_PROFILE },
    cancellation: { customerCancelEnabled: true, cancelCutoffMinutes: 120 },
    invites: [],
    floorPlan: { draft: null, published: null, publishedAt: null },
    queue: [],
    // Tonight's sample bookings (same as the admin designs). Pending requests do not hold a table until
    // staff allocate them. VIP (24 seats = 2 tables) has 1 of 2 tables taken, so one more customer booking fills it.
    bookings: [
      existing(1, "เจ๊ม่อน", "0919119911", "12+", outdoor, "confirmed", "line", 9, "20:00:00"),
      existing(2, "คุณเมย์", "0812345678", "5-8", indoor, "pending", "line", 12, "20:00:02"),
      existing(3, "คุณนัท", "0893456789", "1-4", vip, "checked_in", "staff"),
      existing(4, "คุณแพรว", "0824567890", "5-8", outdoor, "confirmed", "line", 11, "20:00:01"),
      existing(5, "คุณบาส", "0856789012", "1-4", outdoor, "pending", "line", 13, "20:00:03"),
      existing(6, "คุณแนน", "0867890123", "5-8", vip, "pending", "line", 14, "20:00:05"),
    ],
    seq: 6,
  };
}

const file = () => process.env.MOCK_DB_PATH ?? path.join(process.cwd(), ".mock", "db.json");
let lock: Promise<unknown> = Promise.resolve();

async function load(): Promise<Db> {
  try {
    const db = JSON.parse(await readFile(file(), "utf8")) as Db;
    db.lineUsers ??= []; // databases saved before LINE login existed
    db.profile ??= { ...DEFAULT_PROFILE };
    db.cancellation ??= { customerCancelEnabled: true, cancelCutoffMinutes: 120 };
    db.invites ??= [];
    db.floorPlan ??= { draft: null, published: null, publishedAt: null }; // databases saved before floor plans existed
    const legacy = db.venue as Db["venue"] & { opensAt?: string };
    legacy.holdUntil ??= legacy.opensAt ?? new Date(0).toISOString();
    legacy.schedule ??= structuredClone(DEFAULT_SCHEDULE);
    legacy.schedule.openWeekdays ??= [0,1,2,3,4,5,6];
    legacy.schedule.closures ??= [];
    const seats: Record<string, number> = { VIP: 24, Indoor: 48, Outdoor: 60 };
    for (const z of db.zones) { z.seats ??= seats[z.name] ?? 20; z.status ??= "open"; }
    for (const b of db.bookings) { b.status ??= "confirmed"; b.channel ??= "line"; }
    let n = Math.max(0, ...db.bookings.map((b) => b.queueNo ?? 0));
    for (const b of db.bookings) if (b.channel === "line" && !b.queueNo) { b.queueNo = ++n; b.requestedAt ??= b.createdAt; }
    return db;
  } catch {
    return seed();
  }
}
async function save(db: Db) {
  await mkdir(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(db, null, 2));
  await rename(tmp, file());
}

/** Run `fn` against the database; changes are saved when it returns. */
export function withDb<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  const run = lock.then(async () => {
    const db = await load();
    const result = await fn(db);
    await save(db);
    return result;
  });
  lock = run.catch(() => undefined);
  return run;
}

export const reset = (opts?: Parameters<typeof seed>[0]) => withDb((db) => { Object.assign(db, seed(opts)); });

export function queueState(db: Db, entry: QueueEntry, now = Date.now()) {
  const step = db.venue.queueStepSeconds;
  const advanced = step <= 0 ? Infinity : Math.floor((now - Date.parse(entry.createdAt)) / (step * 1000));
  const position = Math.max(1, entry.startPosition - advanced);
  return { position, ready: position === 1 };
}

export function zoneAvailability(db: Db, date: string) {
  return db.zones.map((zone) => {
    const left = tablesFor(zone) - db.bookings.filter((b) => b.serviceDate === date && b.zoneId === zone.id && (b.status === "confirmed" || b.status === "checked_in")).length;
    const closed = zone.status === "closed";
    return { id: zone.id, name: zone.name, tablesLeft: Math.max(0, left), available: left > 0 && !closed, closed };
  });
}
