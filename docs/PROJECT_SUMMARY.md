# Bookie Lyon (bookie-booike): สรุปโปรเจค

ฉบับ 13 พฤศจิกายน 2569 · repo [tmno-O/bookie-booike](https://github.com/tmno-O/bookie-booike) · branch `main`

**สถานะ:** ระบบจองโต๊ะผ่าน LINE ทำงานครบทั้งฝั่งลูกค้าและฝั่งร้าน หน้าจอต่อกับ backend จริงแล้ว ผ่าน unit test 65 ตัว, integration test 25 ตัว และ load test 5,000 คำขอพร้อมกันโดยไม่จองซ้อน เหลือขั้นขึ้น cloud (Supabase, Vercel, LINE LIFF) ซึ่งต้องใช้บัญชีของเจ้าของ repo ตาม [DEPLOY.md](DEPLOY.md)

## 1. โปรเจคนี้คืออะไร

ระบบจองโต๊ะสำหรับร้านกลางคืนที่เปิดรับจองพร้อมกันเป็นรอบ ลูกค้าเข้าผ่าน LINE (LIFF) กดรับคิว พอถึงคิวจึงเลือกคืน จำนวนคน และโซน ระบบตัดสินผลตามลำดับคิวแบบ FIFO และไม่ให้จองเกินความจุ ฝั่งร้านมีหน้า admin สำหรับดูการจอง เช็กอิน จองแทนลูกค้า จัดสรรโซน และตั้งค่าร้าน

ปัญหาที่ระบบแก้คือ ตอนเปิดจองมีคนกดพร้อมกันจำนวนมาก ระบบต้องรับคำขอได้ทั้งหมด เรียงคิวอย่างยุติธรรม และไม่ให้โต๊ะเดียวถูกจองซ้ำ

## 2. ทีมและบทบาท

| คน | บทบาท | งานหลัก |
| --- | --- | --- |
| Gunnatee5144 | Backend | schema, API, คิว FIFO (SQS และ DB queue), auth, การเชื่อม FE กับ API จริง, deploy, load test |
| tmno-O | Frontend, เจ้าของ repo | หน้าจอลูกค้า 6 จอและหน้า admin ทั้งหมดตาม Figma, mock API |

## 3. ฟีเจอร์

### ลูกค้า (`/book/<slug>/...`)

| ขั้น | หน้า | ทำอะไร |
| --- | --- | --- |
| 0 | `login` | เข้าสู่ระบบด้วย LINE (LIFF จริง หรือบัญชี mock ตอนทดสอบ) |
| 1 | `details` | กรอกชื่อและเบอร์โทร |
| 2 | `waiting` | นับถอยหลังถึงเวลาเปิดจอง แล้วกดรับคิว |
| 3 | `queue` | ดูตำแหน่งคิวแบบสด พอถึงคิวจึงไปขั้นต่อไป |
| 4 | `select` | เลือกคืน จำนวนคน (`1-4`, `5-8`, `9-12`, `12+`) และโซน แล้วส่งคำขอ |
| 5 | `confirmed` | แสดงผลพร้อมเลขอ้างอิง `BL-YYYY-NNNN` |
| 6 | `bookings` | ประวัติการจองของตัวเอง |

### ร้าน (`/admin/...`)

| หน้า | ทำอะไร | สิทธิ์ |
| --- | --- | --- |
| Login | email + รหัสผ่านผ่าน Supabase Auth, session cookie อายุ 8 ชั่วโมง | ทุก role |
| Dashboard | ยอดจอง จำนวนแขก รอจัดสรร เช็กอิน และความจุโซนรายคืน | ทุก role |
| รายการจอง | กรองตามคืน สถานะ โซน และค้นชื่อ เบอร์ หรือเลขอ้างอิง | ทุก role |
| รายละเอียด + เช็กอิน | เช็กอินได้ครั้งเดียว และเฉพาะคืนที่จอง | ทุก role |
| จองแทนลูกค้า | กรอกชื่อและเบอร์ เข้าคิว FIFO เดียวกับลูกค้า | ทุก role |
| คิว + จัดสรรโซน | ยืนยันคำขอที่รอจัดสรร (โหมด manual) หรือย้ายโซน | ทุก role |
| โซนและความจุ | ตั้งความจุเป็นจำนวนที่นั่ง (12 ที่ต่อโต๊ะ) และเปิด/ปิดโซน | ทุก role |
| เวลาเปิดจอง | ค่ามาตรฐาน (เปิดล่วงหน้า N วัน เวลา HH:mm) และวันพิเศษ | owner |
| ตั้งค่าร้าน + ทีม | ข้อมูลร้าน นโยบายเข้าร้าน และคำเชิญพนักงาน | owner |

## 4. สถาปัตยกรรม

```
LINE (LIFF) / เบราว์เซอร์ admin
        │
        ▼
Next.js 16 (หน้าเว็บ + API routes)  ── Supabase Auth (staff login)
        │
        ▼
คิวจอง: QUEUE_DRIVER
  ├─ db  (หลัก) : ตาราง booking_requests → drain_booking_requests() (API after() + Supabase Cron)
  └─ sqs (ทางเลือก): SQS FIFO (ElasticMQ ในเครื่อง) → booking worker (Node)
        │
        ▼
Postgres: process_booking_request() ตัดสินแบบ atomic → bookings / allocations / outbox
```

| ส่วน | เทคโนโลยี |
| --- | --- |
| เว็บและ API | Next.js 16, React 19, TypeScript, Zod 4 |
| ฐานข้อมูลและ Auth | Supabase Postgres 17, Supabase Auth, postgres.js |
| คิว | DB queue ใน Postgres + Supabase Cron (หลัก), SQS FIFO + worker (ทางเลือก) |
| LINE | LIFF login, ตรวจ ID token กับ LINE, notification outbox |
| ทดสอบ | Vitest (unit, integration), k6 (spike, burst) |
| Deploy | Vercel (`sin1`) + Supabase cloud (Singapore) |

### หลักการที่กันจองซ้อน

- ทุกการตัดสินผ่าน `process_booking_request()` ใน Postgres ตัวเดียว ล็อกต่อร้าน/คืนบริการ และมี unique constraint ให้หนึ่งโต๊ะมีการจองที่ active ได้หนึ่งรายการต่อคืน
- ทุกคำขอต้องมี `Idempotency-Key` ส่งซ้ำได้ผลเดิม ส่ง key เดิมแต่ payload ต่างได้ `422`
- `202` หมายถึงคำขอเข้าคิวแล้ว ยังไม่ใช่จองสำเร็จ ลูกค้าดูผลจาก status API
- Rate limit ต่อ session ตั้งค่าเริ่มต้น 30 คำขอต่อนาที

### คิว: เลือก DB queue เป็นตัวหลัก

ออกแบบด้วย SQS FIFO + worker ก่อน แล้ววัดผลเทียบกับ DB queue ด้วย k6 (หัวข้อ 7) DB queue รับคำขอเร็วกว่าประมาณ 6 เท่า ไม่มี timeout ตัดสินผลทันที และไม่ต้องมี AWS หรือ worker server จึงเลือกเป็นค่าเริ่มต้นทั้งในเครื่องและ production ส่วน SQS คงไว้เป็นทางเลือกสำหรับขยายระบบ

| | `db` (หลัก ค่าเริ่มต้น) | `sqs` (ทางเลือก) |
| --- | --- | --- |
| ลำดับคิว | `queue_seq` ตามลำดับที่ commit ลง DB | ลำดับที่ SQS รับข้อความ |
| ตัวตัดสิน | procedure ใน Postgres | worker ที่รันค้างตลอด |
| ตัวกระตุ้น | `after()` หลังตอบ 202 + Cron ทุก 1 วินาที | long-poll |
| ต้องมี | Supabase อย่างเดียว | AWS SQS + worker server |

โหมด `db` หยิบเฉพาะคำขอเก่าสุดของแต่ละร้าน/คืนด้วย `FOR UPDATE SKIP LOCKED` แล้ว commit ทีละรายการ drain หลายตัวจึงรันพร้อมกันได้โดยลำดับในคืนเดียวกันไม่สลับ ห้ามรันสองโหมดบนฐานข้อมูลเดียวกันพร้อมกัน

## 5. ฐานข้อมูล

Migration 17 ไฟล์ใน `supabase/migrations/` ตารางหลัก:

| กลุ่ม | ตาราง |
| --- | --- |
| ร้านและสิทธิ์ | `venues`, `venue_settings`, `venue_members`, `venue_invites`, `staff_sessions` |
| ลูกค้าและ LINE | `customers`, `customer_identities`, `venue_customers`, `customer_sessions`, `venue_line_integrations` |
| โซน โต๊ะ กฎ | `zones`, `venue_tables`, `booking_rules`, `booking_releases` |
| คิวและการจอง | `queue_tickets`, `booking_requests`, `bookings`, `booking_allocations`, `booking_events`, `booking_rate_limits` |
| งานเบื้องหลัง | `notification_outbox`, `audit_logs` |

ทุกตารางผูกกับร้าน (`venue_id`) ลูกค้าเห็นเฉพาะข้อมูลของตัวเอง ส่วนพนักงานเห็นเฉพาะร้านที่เป็นสมาชิก ถ้าเรียกข้ามร้านจะได้ 404

## 6. API

Endpoint จริง 45 route (ไม่รวม mock 32 route) รายละเอียดอยู่ใน [API_CONTRACT.md](API_CONTRACT.md)

- ลูกค้า: session LINE, ข้อมูลร้าน, availability, queue ticket, booking request, การจองของฉัน, ยกเลิก
- พนักงาน (`/api/staff/venues/{venueId}/...`): dashboard, bookings, check-in, booking-requests, queue/allocate, zones, tables, hours, settings, team, rules, releases, line-integration, customers
- ระบบ: `GET /api/health`
- FE สลับ mock กับ API จริงด้วย `NEXT_PUBLIC_API_MODE=mock|real` (`src/client/`)

## 7. การทดสอบและผล

| ชุด | จำนวน | ครอบคลุม |
| --- | --- | --- |
| Unit (`npm test`) | 65 | contracts, env, permissions, mock API |
| Integration (`npm run test:integration`) | 25 | tenant isolation, staff role, queue ticket, FIFO, crash recovery, idempotency, check-in, staff booking, allocation, zones, hours, team และคิวโหมด `db` |
| k6 spike | 20 VUs | ได้ 202 ทั้ง 20, ยืนยัน 1, ที่เหลือ `TABLE_UNAVAILABLE` |
| k6 burst | 5,000 คำขอ | ดูตารางด้านล่าง |

ผล burst 5,000 คำขอแย่งโต๊ะเดียว ส่งพร้อมกัน 250 บนเครื่อง local (หลักฐานครบอยู่ใน [evidence](evidence/README.md)):

| | `sqs` + worker | `db` |
| --- | --- | --- |
| ได้ 202 | 4,714 (timeout 286) | 5,000 |
| เวลารับครบ | 403 วินาที | 68.5 วินาที |
| POST median / p95 | 5.3 / 90.0 วินาที | 3.4 / 4.4 วินาที |
| ผลการจอง | confirmed 1, rejected 4,999 | confirmed 1, rejected 4,999 |

ตัวเลขนี้เทียบสองโหมดบนเครื่องเดียวด้วย `next dev` ไม่ใช่ความเร็วบน cloud

## 8. ไทม์ไลน์

| วันที่ | งาน |
| --- | --- |
| 10 พ.ย. 2569 | Backend: schema, auth, staff API, rules, atomic allocation, FIFO + worker, recovery, staff booking, ยกเลิก, LINE outbox, demo (15 commit) |
| 11 พ.ย. 2569 | Frontend: หน้าลูกค้า 6 จอและหน้า admin ทั้งหมดบน mock API (PR #1) |
| 12 พ.ย. 2569 | เชื่อม FE กับ API จริงครบ 13 ฟีเจอร์ พร้อม k6 burst (PR #2) และเตรียม deploy: pooler, คิวใน DB, Vercel region (PR #3) |
| 13 พ.ย. 2569 | หลักฐาน k6 เทียบสองโหมด และอัปเดตเอกสารทั้งหมด |
| 18 พ.ย. 2569 | นำเสนอ (ตามกำหนดรายวิชา รอยืนยัน) |

## 9. สิ่งที่เหลือ

**ต้องทำก่อนใช้จริง** ตาม [DEPLOY.md](DEPLOY.md):
1. Supabase cloud: `db push`, ตั้ง Cron, ตั้ง Auth และใส่ข้อมูลร้าน
2. Vercel: import repo, ตั้ง env และ deploy
3. LINE Login + LIFF: Endpoint `https://<domain>/book/<slug>/login`
4. ทดสอบบนมือถือจริงและ k6 บน cloud

**นอกขอบเขตรอบนี้:** มัดจำ ชำระเงิน คืนเงิน, rich menu publish, LINE webhook, ส่งอีเมลคำเชิญ, หน้าสมัคร owner, การรับคำเชิญ, รีเซ็ตรหัสผ่าน, no-show auto-release, แจ้งเตือน LINE บน Vercel และข้อความขอ consent PDPA สำหรับเบอร์โทร

**ก่อน demo ในเครื่อง:** รัน `npx supabase db reset` เพื่อล้างข้อมูลทดสอบจาก k6

## 10. รันในเครื่อง (ย่อ)

```powershell
npm ci
npx supabase start
Copy-Item .env.example .env.local   # ใส่ LINE_SECRET_KEY และ SUPABASE_PUBLISHABLE_KEY
$env:NEXT_PUBLIC_API_MODE = 'real'
npm run dev -- --port 3100
```

- ลูกค้า: http://localhost:3100/book/bookie-demo
- Admin: http://localhost:3100/admin/login ด้วย `owner@bookie.test` หรือ `staff@bookie.test` รหัส local `BookieDemo123!` (บัญชีทดสอบจาก seed ใช้เฉพาะในเครื่อง)

ขั้นตอนเต็มอยู่ใน [README](../README.md)

## 11. แผนที่เอกสาร

| เอกสาร | เนื้อหา |
| --- | --- |
| [README](../README.md) | วิธีรัน ทดสอบ พฤติกรรมระบบ และผลทดสอบ |
| [API_CONTRACT.md](API_CONTRACT.md) | สัญญา API ทั้งหมด |
| [DEPLOY.md](DEPLOY.md) | คู่มือขึ้น Vercel + Supabase + LINE |
| [MOCK_TESTING.md](MOCK_TESTING.md) | ทดสอบหน้าจอด้วย mock และโหมด real |
| [evidence/](evidence/README.md) | หลักฐาน k6 พร้อมรายงาน HTML |
| [SRS_Bookie_Lyon.md](SRS_Bookie_Lyon.md) | ข้อกำหนดระบบ |
| [TECH_STACK_PLAN.md](TECH_STACK_PLAN.md), [backend/](backend/BACKEND_PLAN.md) | เอกสารออกแบบเดิม (5 พ.ย.) พร้อมหมายเหตุอัปเดต |
| [backend-dev-1.md](backend-dev-1.md), [backend-dev-2.md](backend-dev-2.md) | แผนงาน backend ที่ทำเสร็จแล้ว เก็บไว้เป็นบันทึก |
