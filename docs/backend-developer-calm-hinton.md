# แผน Backend: Bookie Bookie (Bookie Lyon)

## Context
โฟลเดอร์ `Hackathon-Final` มีแต่เอกสาร ไม่มีโค้ด ไม่ใช่ git repo; remote `https://github.com/tmno-O/bookie-booike.git` ว่าง
ผู้ใช้รับบท Backend ต้องสร้างระบบจองโต๊ะร้านผ่าน LINE OA/LIFF ตามเอกสาร ทำทีละขั้น แต่ละขั้นเสร็จ = test ผ่าน + commit + push `main`
ช่วงพัฒนา 9–17 พ.ย. 2569 (วันนี้ 10 พ.ย.) นำเสนอ 18 พ.ย.

### ขอบเขต (ยึด URS + Sprint Plan ฉบับ 8–9 พ.ย. ซึ่งใหม่กว่า backend docs 5 พ.ย.)
- ทำ: LINE identity/session, staff role ต่อร้าน, ร้าน/โซน/โต๊ะ/ความจุ/กฎ, availability, คำขอจอง FIFO + worker, กันซ้อน/กันซ้ำ, สถานะคำขอ, จองแทน, รายการ + ยกเลิก, tenant isolation, audit
- ทำถ้ามีเวลา: notification outbox ส่ง LINE, Rich Menu preview/publish
- ไม่ทำ: มัดจำ/payment/refund/payout (URS นอกขอบเขต), check-in/no-show (รอ D16)

### การตัดสินใจจากผู้ใช้
- เลือกโต๊ะ: รองรับ 2 แบบ ร้านตั้งใน setting `table_selection_mode` = `customer_picks` (ส่ง tableId) | `auto_assign` (ส่ง zoneId + partySize, worker หาโต๊ะเล็กสุดที่จุพอ)
- Queue: ElasticMQ ใน Docker (SQS-compatible, FIFO) ตอน dev; SQS จริงสลับด้วย env
- DB: Supabase local (`supabase start`, Docker)
- Git: push `main` ตรง; เอกสารย้ายเข้า `docs/` ยกเว้น `Pitching&Hackathon_2569.pptx.pdf` (104MB เกิน GitHub limit) ใส่ `.gitignore`

### สมมติฐานที่ใช้ (กฎยังไม่ปิด D01–D06, ทำเป็นค่าตั้งได้ ไม่ hardcode)
- 1 โต๊ะ = 1 allocation active ต่อ service_date (ตามแผนเดิม)
- กฎ: table override > zone rule > venue default; field `min_notice_minutes`, `max_advance_days`, `open_weekdays`, `closed`
- ยกเลิกได้ก่อน `cancel_cutoff_minutes` (ค่าร้าน); ร้านยกเลิกได้เสมอ
- service_date = วันเริ่มคืนบริการตาม timezone ร้าน (Asia/Bangkok), เวลาจริงเก็บ UTC timestamptz
- งานหัวคิวล้ม: retry N ครั้ง แล้วบันทึก `rejected/SYSTEM_ERROR` + audit + log แจ้ง แล้วค่อย ack (ไม่ข้ามเงียบ)

## โครงสร้าง repo
```
app/api/**/route.ts        Next.js route handlers (Node runtime)
src/lib/                   env (Zod), db (postgres.js), sqs client, errors, http helpers, crypto (AES-GCM)
src/lib/auth/              line-verify, customer-session, staff-auth, permissions
src/contracts/             Zod schemas request/response (Frontend import ได้)
src/server/services/       venue, rules, availability, booking-request, staff, cancellation
worker/                    booking-worker.ts, reconcile.ts (รันด้วย tsx)
supabase/migrations/       SQL schema + RPC
supabase/seed.sql          ร้าน demo
tests/unit, tests/integration, tests/load (k6)
docker-compose.yml         ElasticMQ (+ elasticmq.conf สร้าง FIFO queue)
docs/                      เอกสารเดิม + API_CONTRACT.md + fixtures/
```
Stack: Next.js App Router + TypeScript, Zod, postgres.js (ต่อ DB ตรง ทำ transaction/RPC), @supabase/supabase-js (ตรวจ staff JWT), @aws-sdk/client-sqs, Vitest

## ขั้นตอน (แต่ละขั้น = 1 commit + push main)

1. **Repo bootstrap** — `git init -b main`, remote add, ย้ายเอกสารเข้า `docs/`, `.gitignore` (node_modules, .env*, Pitching PDF), README สั้น
   commit: `chore: initialize repository with project documents`
2. **Scaffold** — Next.js TS, ESLint, Vitest, `src/lib/env.ts` (Zod ตรวจ env), `docker-compose.yml` ElasticMQ, `supabase init`, `.env.example`, `GET /api/health` (เช็ก DB + SQS)
3. **API contract + fixtures (T03)** — `docs/API_CONTRACT.md`, Zod schemas ใน `src/contracts/`, error format `{error:{code,message}}`, fixtures JSON ให้ Frontend ทำขนาน
4. **Core schema (T04)** — migration: venues (timezone, table_selection_mode, cancel_cutoff_minutes), venue_members(role owner/staff), customers, customer_identities(provider_id, subject unique), venue_customers, customer_sessions(token_hash), zones(capacity), venue_tables(capacity, price_satang null, status), booking_rules(scope venue/zone/table, version), booking_releases, venue_line_integrations(encrypted secrets), audit_logs; composite tenant FK `(venue_id, id)`; RLS เปิด deny anon; seed ร้าน demo
5. **Auth (T05)** — `POST /api/session/line` ตรวจ ID token ที่ `https://api.line.me/oauth2/v2.1/verify` ด้วย channel ID ของร้าน, upsert identity + venue_customer, ออก session cookie httpOnly (opaque token, เก็บ hash); `POST /api/session/logout`; staff: Bearer Supabase JWT + `venue_members` role; `LINE_VERIFY_MODE=mock` ใช้ได้เฉพาะ non-production; tests ข้ามร้าน/ข้ามบัญชี
6. **Venue management API (UR-14–18, FR-01,07–09,12)** — staff routes: venue profile, zones CRUD, tables CRUD (โต๊ะต้องมีโซน, ปิดโต๊ะไม่ลบ booking), rules GET/PATCH (เพิ่ม version), settings (table_selection_mode), line-integration GET/PATCH (เก็บ secret AES-GCM, ไม่คืนค่า secret), booking-link (LIFF URL + QR SVG); owner vs staff permission; audit log
7. **Public venue + availability (T08)** — `GET /api/venues/by-slug/{slug}`, `/availability?date=`, `/releases`; SQL function `effective_rule(table, service_date)` ใช้ชุดเดียวกับ worker; unit tests กฎ + ข้ามเที่ยงคืน
8. **Booking schema + RPC (T11)** — tables: booking_requests(idempotency_key, payload_hash, actor_type, source, status, result_code, booking_id), bookings, booking_allocations (partial unique `(table_id, service_date) where active`), booking_events, notification_outbox; RPC `process_booking_request(request_id)`: lock request → ตรวจกฎซ้ำ → เลือก/ตรวจโต๊ะ (2 mode) → insert allocation+booking+event+outbox+result ใน transaction เดียว, เรียกซ้ำได้ผลเดิม; integration test คำขอพร้อมกันโต๊ะเดียว = booking 1
9. **Booking request API (T10)** — `POST /api/booking-requests` (header `Idempotency-Key`, key เดิม payload ต่าง = 422), insert `pending_publish` → SQS SendMessage (`MessageGroupId=venueId:serviceDate`, `MessageDeduplicationId=requestId`) → `queued` → 202 `{requestId}`; `GET /api/me/booking-requests/{id}` เฉพาะเจ้าของ; rate limit ต่อ session (DB-based)
10. **Worker (T09)** — `worker/booking-worker.ts` long-poll, ประมวลผลเรียงทีละข้อความในกลุ่ม, เรียก RPC, delete หลัง commit, ต่อ visibility ระหว่างทำ, retry/poison rule ตามสมมติฐาน; `worker/reconcile.ts` ส่ง `pending_publish` ค้างซ้ำ (requestId เดิม)
11. **Staff-assisted booking (T13)** — `GET /api/staff/venues/{id}/customers?q=` (เฉพาะ venue_customers แสดง display name + เบอร์ท้าย 4 หลักแยกชื่อซ้ำ), `POST /api/staff/venues/{id}/booking-requests` เข้าคิวกลุ่มเดียวกัน actor/source จาก server
12. **รายการ + ยกเลิก (T15)** — `GET /api/me/bookings[/{id}]`, `POST /api/me/bookings/{id}/cancel`; staff `GET/PATCH /api/staff/venues/{id}/bookings[/{id}]`; RPC `cancel_booking` ปล่อย allocation + event + audit atomic, ตรวจ cutoff
13. **Recovery + E2E tests (T17–18)** — worker crash ก่อน/หลัง commit, redelivery, pending_publish reconcile, ลูกค้า 2 + staff 1 แย่งโต๊ะเดียว (AT-02), ข้ามร้าน (AT-04), ข้ามเที่ยงคืน (AT-06), ปิดโต๊ะหลังจอง (AT-07); `tests/load/booking-spike.js` k6
14. **(ถ้ามีเวลา) Notification + Rich Menu** — outbox worker push Flex card ผ่าน token OA ร้าน, ส่งไม่ได้ไม่ย้อน booking, retry/backoff (AT-05); rich-menu-preview/publish ต้อง confirm
15. **Demo seed + runbook (T19–20)** — seed ร้าน/โซน/โต๊ะ/staff ตัวอย่าง, README วิธีรัน, ข้อจำกัด/งานค้าง

## Verification ทุกขั้นก่อน commit
- `npm run lint && npm run typecheck && npm test`
- integration: `supabase start` + `docker compose up -d` แล้ว `npm run test:integration` (DB จริง local)
- ขั้น 9–10: รัน `npm run dev` + `npm run worker`, ยิง curl POST booking → poll status ได้ `confirmed`; ยิงพร้อมกัน 20 คำขอโต๊ะเดียว ได้ confirmed 1 ที่เหลือ `TABLE_UNAVAILABLE`
- `git push origin main` สำเร็จ (ครั้งแรกอาจต้อง login GitHub credential ของผู้ใช้)
