# แผนเชื่อม Frontend กับ Backend ของ Bookie Bookie

> **สถานะ 13 พ.ย. 2569:** ทำครบทุกขั้นแล้ว (PR #2) เก็บไว้เป็นบันทึก. ขั้น deploy ย้ายไปที่ [DEPLOY.md](DEPLOY.md) และใช้ Vercel + Supabase ด้วย `QUEUE_DRIVER=db` แทน SQS/worker บน cloud. Flow ห้องรอในบันทึกนี้ถูกแทนด้วย FCFS ภายหลังใน PR #22. ดู [สรุปปัจจุบัน](PROJECT_SUMMARY.md).

## จุดเริ่มต้นของงาน ณ 12 พฤศจิกายน 2569

**Frontend (tmno-O, merge PR #1 เมื่อ 11 พ.ย.)** — UI ครบทุกหน้า Figma แต่ยิง `/api/mock/*` ทั้งหมด (JSON file `.mock/db.json`)
- ลูกค้า 6 จอ: login LINE (mock) → details → waiting (นับถอยหลังเปิดจอง) → queue (เลขคิวลดลง) → select (คืน/จำนวนคน bucket `1-4|5-8|9-12|12+`/โซน) → confirmed → my bookings
- Admin: login mock (owner/staff ไม่มีรหัสผ่าน), dashboard, booking list (filter/search/day stepper), details + check-in, staff-assisted booking, queue + จัดสรรโซน, zones/capacity, เวลาเปิดจอง (standard/special), settings ร้าน + team/invites
- Spec พฤติกรรม: `docs/MOCK_TESTING.md`, `src/mock/*`, `tests/unit/mock-api.test.ts` (689 บรรทัด)

**Backend (Gunnatee5144, 10 พ.ย. ล่าสุด `4c2cdba`)** — API จริงบน Supabase Postgres + SQS FIFO + worker
- เสร็จ: schema tenant-scoped, LINE session (verify mode mock ได้), staff Bearer auth + role, venue/zones/tables/rules/releases/settings/line-integration/booking-link, availability, booking-requests idempotent → SQS FIFO → worker allocate atomic, reconcile/recovery, staff-assisted booking, list/cancel bookings, notification outbox retry, demo + runbook
- งานค้าง local (ยังไม่ commit): `tests/load/booking-burst.js` (k6 ยิง 5,000 คำขอ) + README section
- Local `main` ตามหลัง `origin/main` 15 commits (งาน FE)

**ช่องว่างระหว่าง FE กับ backend** (ตัดสินแล้ว: backend ปรับตาม FE, เราแก้ FE client เอง, เก็บเบอร์เต็ม)
- Flow: FE "รับคิวก่อน → ถึงตาค่อยเลือกโซน" vs backend "เลือกแล้วส่ง FIFO" → เพิ่ม queue ticket + position
- FE เลือกระดับโซน + party bucket vs backend partySize int + tableId
- FE มีสถานะ `pending`(รอจัดสรร)/`checked_in`, reference `BL-YYYY-NNNN`, channel line/staff, ชื่อ+เบอร์เต็ม — backend ยังไม่มี
- Admin ขาด endpoint: staff cookie login, dashboard, list+search, check-in, queue/allocate, zone seats, hours standard/special, profile (phone/address/entryPolicy), team/invites

## กติกาการทำงาน (ทุกขั้น)

1. ทำ **ทีละฟีเจอร์** บน branch `feat/real-api-integration` (ไม่ commit ตรง `main`)
2. ฟีเจอร์เสร็จ = migration + service + route + Zod contract + test + FE adapter ของจอนั้น
3. ผ่าน gate: `npm run typecheck` · `npm run lint` · `npm test` · `npm run test:integration` (ต้อง `supabase start` + docker compose)
4. **`git commit` (1 ฟีเจอร์ = 1 commit) แล้ว `git push` ทันที** → ค่อยเริ่มฟีเจอร์ถัดไป
5. ไม่ลบ mock: FE เลือกโหมดด้วย `NEXT_PUBLIC_API_MODE=mock|real` ให้คน FE พัฒนาต่อได้

Reuse: `src/lib/http.ts` (`route`,`json`,`body`), `src/lib/errors.ts` (`ApiError`), `src/server/staff-route.ts`, `src/lib/auth/{customer-session,staff-auth,permissions}.ts`, `src/server/services/{booking-request,inventory,availability,bookings,venue,staff}.ts`, `worker/consume.ts`, SQL `effective_rules`. ใช้ logic/error code ใน `src/mock/*` เป็น spec (`ZONE_FULL`, `ZONE_CLOSED`, `NIGHT_NOT_OPEN`, `ALREADY_CHECKED_IN`, `NOT_SERVICE_DATE`, `CAPACITY_BELOW_BOOKED`, `ZONE_NAME_TAKEN`, ...)

## ขั้นตอน

### ขั้น 0 — Sync + เก็บงานค้าง
- `git stash` → `git pull --ff-only` → `git switch -c feat/real-api-integration` → `git stash pop`
- รัน gate ทั้งหมดบนโค้ดรวม FE+BE ให้เขียวก่อน
- commit `test: add a 5,000-request booking burst load test` → `git push -u origin feat/real-api-integration`

### ขั้น 1 — FE API mode switch + LINE login จริง
- `app/book/[slug]/flow.ts`, `app/admin/admin-api.ts`: แยก transport; โหมด real เรียก endpoint จริง + map response เป็น type เดิมของ FE (ใส่ใน `src/client/` ใหม่)
- Login ลูกค้า: `POST /api/session/line` ด้วย `{venueSlug, idToken:"mock:<id>:<name>"}` (`LINE_VERIFY_MODE=mock`), เพิ่ม `GET /api/me` (profile) ใช้ customer-session เดิม
- commit `feat: switch the customer client to the real session API` → push

### ขั้น 2 — ตารางเปิดจอง + ข้อมูลร้านสาธารณะ
- Migration: `venue_settings` + `release_days_before`, `release_time`; special day ใช้ `booking_releases` ต่อคืน; `venues` + `phone`, `address`, `entry_policy`
- Service `opensAtFor(serviceDate)` (Bangkok) ใช้ร่วม availability/worker
- ขยาย `GET /api/venues/by-slug/{slug}`: `opensAt, open, secondsUntilOpen, today, maxAdvanceDays, shop`
- FE waiting screen ใช้ real · commit `feat: expose the opening schedule to customers` → push

### ขั้น 3 — Queue ticket + ตำแหน่งคิว
- Migration `queue_tickets` (venue, customer, contact_name, contact_phone เต็ม, seq bigserial, status `waiting|ready|used|expired`, ready_at)
- `POST /api/venues/{venueId}/queue-tickets` (ซ้ำคืน ticket เดิม, `NOT_OPEN` ก่อนเวลา, rate limit เดิม), `GET /api/me/queue-tickets/{id}` คืน `position, ready, bookingId`
- Position = ticket ที่ seq น้อยกว่าและยังไม่ used/expired; ready เมื่อ position ≤ admit window (setting, ค่าเริ่ม 1) + TTL ready หมดแล้ว expire (cron/reconcile)
- Test: ลำดับคงที่ภายใต้ concurrent insert, ซ้ำไม่ได้ ticket ใหม่ · FE queue screen · commit `feat: issue queue tickets with live positions` → push

### ขั้น 4 — เลือกโซน + จองผ่าน FIFO (หัวใจ demo)
- Migration `bookings` + `reference` (unique ต่อ venue, `BL-YYYY-NNNN`), `contact_name`, `contact_phone`, `source`, `status` เพิ่ม `pending_allocation|checked_in`, `checked_in_at`; `venue_settings.allocation_mode auto|manual`
- Availability เพิ่ม `zones[]: {id,name,tablesLeft,available,closed}` + `nightOpen/opensAt`
- `POST /api/booking-requests` รับ `ticketId` + `zoneId` + `partyBucket` (map เป็น partySize 4/8/12/15) ตรวจ ticket ready+เจ้าของ, `NIGHT_NOT_OPEN`; ticket → used
- Worker: auto = จองโต๊ะเล็กสุดที่พอในโซน → confirmed / `ZONE_FULL`; manual = booking `pending_allocation` ไม่ถือโต๊ะ
- FE select → poll `/api/me/booking-requests/{id}` → confirmed · Test integration: FIFO ไม่ oversell, idempotent retry
- commit `feat: book a zone from a ready queue ticket` → push

### ขั้น 5 — My bookings + หน้า confirmed
- `/api/me/bookings[/{id}]` คืน `reference, name, phone, zoneName, party, status`; FE `/bookings`, `/confirmed` real
- commit `feat: return booking references and contact details to customers` → push

### ขั้น 6 — Staff login แบบ cookie
- `POST /api/staff/session` (email+password ผ่าน Supabase Auth ฝั่ง server, httpOnly cookie), `GET /api/staff/me` (venue + role), `POST /api/staff/session/logout`; `staffSession` รับ cookie หรือ Bearer
- Seed `owner@bookie.test` / `staff@bookie.test` (รหัสผ่านทดสอบใน `supabase/seed.sql` + README)
- FE admin login เพิ่มช่องรหัสผ่าน · commit `feat: sign staff in with a session cookie` → push

### ขั้น 7 — Dashboard + booking list + details
- `GET /staff/venues/{id}/dashboard?date=` (metrics, bookings, zone seat usage), `GET /bookings?date&status&zone&q` (ชื่อ/เบอร์/reference), `GET /bookings/{id}`
- FE dashboard, bookings screen, details dialog · commit `feat: add the staff dashboard and booking search` → push

### ขั้น 8 — Check-in
- RPC atomic: once (`ALREADY_CHECKED_IN`), เฉพาะคืนนั้น (`NOT_SERVICE_DATE`), audit log; `POST /staff/venues/{id}/bookings/{bookingId}/check-in`
- commit `feat: check guests in on their service night` → push

### ขั้น 9 — Staff-assisted booking ด้วยชื่อ+เบอร์
- `POST /staff/venues/{id}/booking-requests` รับ `name, phone, serviceDate, party, zoneId` → upsert `venue_customers` ตามเบอร์ → FIFO เดียวกัน, source `staff_assisted`, ไม่ใช้ ticket/schedule
- FE add-booking dialog · commit `feat: let staff book by name and phone` → push

### ขั้น 10 — Admin queue + จัดสรรโซน
- `GET /staff/venues/{id}/queue?date&status` (เลขคิว, เวลาส่ง), `POST /queue/{bookingId}/allocate {zoneId?}` RPC lock + capacity (`ZONE_FULL` → FE โชว์ zone picker, `ALREADY_ALLOCATED`)
- commit `feat: allocate pending requests to zones` → push

### ขั้น 11 — Zones & capacity
- Zone มี `seats`; sync โต๊ะ 12 ที่/โต๊ะ = ceil(seats/12) (ปิดโต๊ะส่วนเกินที่ไม่มี booking), `ZONE_NAME_TAKEN`, `CAPACITY_BELOW_BOOKED`, closed ไม่รับจองใหม่
- commit `feat: manage zone capacity in seats` → push

### ขั้น 12 — เวลาเปิดจอง (admin)
- `GET /hours`, `PUT /hours/standard`, `POST/DELETE /hours/special[/{id}]` owner only (`403 FORBIDDEN` staff)
- commit `feat: edit the booking opening schedule` → push

### ขั้น 13 — Settings ร้าน + ทีม/คำเชิญ
- `GET/PUT /settings` profile (owner only); migration `venue_invites`; `GET /team`, `POST/DELETE /team/invites[/{id}]` (กันซ้ำ/สมาชิกเดิม; บันทึกอย่างเดียว ไม่ส่งอีเมล)
- commit `feat: manage the shop profile and staff invitations` → push

### ขั้น 14 — ตรวจรวม + เอกสาร + PR
- Demo E2E โหมด real: `supabase start`, `docker compose up`, `npm run worker`, `npm run dev -- --port 3100` เดินทุกจอลูกค้า 2 หน้าต่าง + admin
- รัน k6 `booking-spike.js` + `booking-burst.js` บันทึกผล
- อัปเดต `docs/API_CONTRACT.md`, `README.md`, `docs/MOCK_TESTING.md` (โหมด real)
- commit `docs: document the integrated API and demo` → push → เปิด PR เข้า `main` ให้ tmno-O review

## นอกขอบเขต demo (บันทึกไว้)
Payment/deposit/refund (F4), rich menu publish, LINE webhook, ส่งอีเมลเชิญจริง, no-show auto-release

## Verification
- ทุกขั้น: gate 4 คำสั่งเขียว + เปิดจอที่แก้ในโหมด `NEXT_PUBLIC_API_MODE=real` ใช้งานได้, โหมด mock ยังผ่าน `tests/unit/mock-api.test.ts`
- ขั้น 4/9/10: integration test แข่งกันจองโซนสุดท้าย ได้ confirmed 1 ที่เหลือ `ZONE_FULL`
- ขั้น 14: k6 burst `booking_accepted=5000`, DB ผล `confirmed`=จำนวนโต๊ะว่าง ที่เหลือ rejected
