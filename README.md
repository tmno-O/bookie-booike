# Bookie Bookie

ระบบจองโต๊ะผ่าน LINE OA และ LIFF ใช้ Next.js, Supabase Postgres และ SQS FIFO. ดู [API contract](docs/API_CONTRACT.md), [คู่มือทดสอบ mock และ real](docs/MOCK_TESTING.md) และ [แผน backend](docs/backend/BACKEND_PLAN.md).

## รันในเครื่อง

ใช้ Node.js 22 ขึ้นไปและ Docker. รันจาก root ของ repo.

```powershell
npm ci
npx supabase start
docker compose up -d
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

ใส่คีย์ที่สร้างใน `LINE_SECRET_KEY` และใช้ `PUBLISHABLE_KEY` จาก `npx supabase status -o env` สำหรับ `SUPABASE_PUBLISHABLE_KEY`. ค่าในตัวอย่างชี้ไปที่ Supabase API พอร์ต `56321`, Postgres พอร์ต `56322` และ ElasticMQ พอร์ต `9324`. ใช้ `npx supabase migration up --local` เมื่อต้องอัปเดต schema ของฐานข้อมูล local เดิม.

ตั้ง `LINE_VERIFY_MODE=mock` ใน `.env.local` สำหรับบัญชี LINE ทดสอบ แล้วเปิด terminal แยกสำหรับเว็บกับ worker.

```powershell
$env:NEXT_PUBLIC_API_MODE = 'real'
npm run dev -- --port 3100
```

```powershell
npm run worker
```

- [หน้าจองของลูกค้า](http://localhost:3100/book/bookie-demo) เดินจาก login ถึงรับคิว เลือกคืนและโซน แล้วดูผลกับประวัติการจอง. ใช้หน้าต่างปกติคู่กับหน้าต่างส่วนตัว หรือใช้สองโปรไฟล์เบราว์เซอร์ เพื่อเห็นคิวขยับหลังส่งคำขอแรก.
- [หน้าแอดมิน](http://localhost:3100/admin/login) ใช้ `owner@bookie.test` หรือ `staff@bookie.test` กับรหัส local `BookieDemo123!`. เจ้าของจัดการเวลาเปิดจอง ข้อมูลร้าน และคำเชิญ. ทั้งสอง role จัดการจอง คิว เช็กอิน และโซน.
- [เดโมเลือกโต๊ะผ่าน API เดิม](http://localhost:3100/book/bookie-demo/demo) และ [สถานะ DB กับคิว](http://localhost:3100/api/health) ใช้ทดสอบระบบเดิมและการเชื่อมต่อ.

`NEXT_PUBLIC_API_MODE=mock` ใช้ JSON mock สำหรับทั้งสองหน้าจอและเป็นค่าเริ่มต้น. รีสตาร์ต Next.js เมื่อเปลี่ยนโหมด. ตัวอย่างขั้นตอนทั้งสองแบบอยู่ใน [คู่มือทดสอบ](docs/MOCK_TESTING.md).

## ทดสอบ

```powershell
npm run typecheck
npm run lint
npm test
npm run test:integration
```

Integration tests ใช้ Supabase, ElasticMQ และ LINE mock. พัก booking worker ของเดโมระหว่างรันชุดนี้. Tests สร้างร้านกับคิวแยกชั่วคราวและล้างข้อมูลร้านทดสอบเมื่อจบ.

### k6 spike และ burst

รันเมื่อเว็บและ booking worker ทำงาน. เลือกคืนอนาคตสองคืนที่โต๊ะ A2 ของ `bookie-demo` ยังว่าง. แต่ละชุดจองโต๊ะเดียวและบันทึกผล contention ในฐานข้อมูล local.

```powershell
$env:BASE_URL = 'http://localhost:3100'
$env:SERVICE_DATE = [DateTimeOffset]::UtcNow.ToOffset([TimeSpan]::FromHours(7)).AddDays(2).ToString('yyyy-MM-dd')
k6 run tests/load/booking-spike.js
```

Burst เตรียม 200 sessions แยกกันแล้วส่งคำขอ session ละ 25 รายการ ภายใต้ rate limit 30 ต่อนาที. ตัวอย่างใช้ Docker และจำกัดจำนวนคำขอค้างพร้อมกันไว้ 250 รายการ. ปรับ `MAX_IN_FLIGHT` ตามทรัพยากรของเครื่อง และตั้ง `VENUE_SLUG` กับ `TABLE_ID` เพื่อใช้ร้านทดสอบอื่น.

```powershell
$env:SERVICE_DATE = [DateTimeOffset]::UtcNow.ToOffset([TimeSpan]::FromHours(7)).AddDays(8).ToString('yyyy-MM-dd')
$env:RUN_ID = [guid]::NewGuid().ToString('N')
$env:BOOKING_REQUESTS = '5000'
$env:MAX_IN_FLIGHT = '250'
$testPath = (Resolve-Path 'tests/load/booking-burst.js').Path
docker run --rm --mount "type=bind,src=$testPath,dst=/burst.js,readonly" -e BASE_URL=http://host.docker.internal:3100 -e SERVICE_DATE -e RUN_ID -e BOOKING_REQUESTS -e MAX_IN_FLIGHT -e REQUESTS_PER_SESSION -e VENUE_SLUG -e TABLE_ID grafana/k6:latest run /burst.js
```

ถ้าใช้ k6 ในเครื่อง ให้รัน `k6 run tests/load/booking-burst.js` กับ `BASE_URL=http://localhost:3100`. เกณฑ์คือ `booking_posts=5000` และ `booking_accepted=5000` ซึ่งนับ HTTP `202`. ดู latency ของ POST จาก `http_req_duration{phase:booking}`. หลัง worker ระบายคิว ให้ตรวจผลตาม `RUN_ID`.

```powershell
docker exec supabase_db_Hackathon-Final psql -U postgres -d postgres -c "select status, result_code, count(*) from public.booking_requests where idempotency_key like 'burst-${env:RUN_ID}-%' group by status, result_code;"
```

สำหรับโต๊ะเดียวที่ว่าง ผลที่คาดคือ `confirmed` 1 และ `rejected/TABLE_UNAVAILABLE` 4,999. หากยังมี `queued` หรือ `pending_publish` ให้รอ worker และตรวจซ้ำ.

### ผลทดสอบ local วันที่ 12 พฤศจิกายน 2569

- Browser E2E โหมด real ผ่านสอง session LINE แยกกัน ครบรับคิว จองอัตโนมัติ จองแบบรอจัดสรร ประวัติ และทุกหน้าแอดมิน. โหมด mock ผ่านการจองและค้นเลขอ้างอิงบน JSON แยก.
- Spike ใช้ 20 VUs จองโต๊ะ A2 คืน 9 ธันวาคม 2569. รับ `202` ครบ 20 รายการ ยืนยัน 1 รายการ อีก 19 รายการได้ `TABLE_UNAVAILABLE`. k6 checks ผ่าน 79/79.
- Burst ใช้ k6 v2.3.0 กับ Next dev, Supabase และ ElasticMQ. คืนทดสอบ 11 ธันวาคม 2569, `RUN_ID=integratedburst20261112b`, `MAX_IN_FLIGHT=250`. ส่งและรับ `202` ครบ 5,000 รายการ, p95 ของ POST 5.34 วินาที. DB หลังระบายคิวยืนยัน 1 รายการและปฏิเสธ 4,999 รายการด้วย `TABLE_UNAVAILABLE`.
- รอบแรกที่ `MAX_IN_FLIGHT=5000` ได้ `202` 555 รายการ, `401` 90 รายการ และเชื่อมต่อไม่สำเร็จ 4,355 รายการ. รอบที่ผ่านแยก cookie jar ต่อบัญชีและใช้เพดาน 250 คำขอพร้อมกัน.

## พฤติกรรมและการกู้คืน

- คิวเรียกทีละ 1 คนโดยค่าเริ่มต้น และให้เวลาเลือก 120 วินาที. คืนบริการมีเวลาเปิดจองตาม Bangkok และใช้วันพิเศษก่อนค่ามาตรฐาน.
- `auto` เลือกโต๊ะว่างขนาดเล็กสุดที่พอในโซน. `manual` สร้างรายการรอจัดสรรและถือโต๊ะเมื่อยืนยัน. ตั้งผ่าน `PATCH /api/staff/venues/{venueId}/settings`. การจองที่ยืนยันและเช็กอินแล้วนับรวมในความจุของคืนบริการ.
- เวลาให้บริการตามกฎร้านมีค่าเริ่มต้น `18:00–02:00` และช่วงจอง 30 วัน. กฎระดับโต๊ะมาก่อนโซนและร้าน. ลูกค้ายกเลิกก่อนเวลาให้บริการอย่างน้อย 120 นาทีโดยค่าเริ่มต้น.
- `202` หมายถึง broker รับคำขอ. หากได้ `503 QUEUE_UNAVAILABLE` ให้ส่งซ้ำด้วย `Idempotency-Key` เดิม. Worker ตรวจ `pending_publish` และหมดอายุ ticket ทุก 15 วินาที. ใช้ `npm run reconcile` เพื่อตรวจทันที.
- Worker ต่อ visibility ระหว่างประมวลผลและลบข้อความหลัง commit. เมื่อ retry ครบ ระบบบันทึก `rejected/SYSTEM_ERROR` พร้อม audit. ติดตาม `pending_publish`, `queued` และ `notification_outbox` จากฐานข้อมูลฝั่ง server.

## เชื่อม LINE และ AWS SQS

- ตั้ง `NEXT_PUBLIC_API_MODE=real` และ `LINE_VERIFY_MODE=real`. ตั้ง LIFF Endpoint URL เป็น `https://<host>/book/<slug>/login` พร้อม scope `openid`. เจ้าของตั้ง LINE Login channel ID, LIFF ID และ provider ID ผ่าน staff API. ใช้ HTTPS สำหรับ session cookie ใน production.
- ตั้ง `SQS_QUEUE_URL` ไปที่ FIFO queue และนำ `SQS_ENDPOINT` ออก. ให้ AWS credentials ของ workload มีสิทธิ์ส่ง รับ ลบ ต่อ visibility และอ่าน queue attributes.
- เปิด LINE push โดยตั้ง access token ของ Messaging API channel ที่ใช้ provider เดียวกับ LINE Login แล้วตั้ง `LINE_NOTIFICATIONS_ENABLED=true` และรัน `npm run worker:notifications`. เก็บ `LINE_SECRET_KEY` ใน secret store ของ environment.
- การทดสอบ local ใช้ LINE mock กับ ElasticMQ. งานนอกขอบเขตเดโมคือการชำระเงิน มัดจำ คืนเงิน, rich menu publish, LINE webhook, ส่งอีเมลคำเชิญ และคืนโต๊ะเมื่อ no-show.
