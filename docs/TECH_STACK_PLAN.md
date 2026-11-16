# Tech Stack ของ Bookie Lyon

อัปเดต 17 พฤศจิกายน 2569 · อ้างอิง branch `feat/fcfs-booking-revamp`

ทีมเปิดระบบบน Vercel และ Supabase พร้อมเชื่อม LINE Login และ LIFF แล้ว งาน FCFS, LINE outbox และ CI ในเอกสารนี้อยู่บน feature branch และผ่านการทดสอบใน CI การเปิด PR, merge, ลง migrations ใหม่ และยืนยัน LINE drain cron บน production ยังรอดำเนินการ [คู่มือ deploy](DEPLOY.md)

## เครื่องมือและหน้าที่

| ส่วน | เทคโนโลยี | หน้าที่ |
| --- | --- | --- |
| เว็บและ API | Next.js 16.4.6 App Router, React 19, TypeScript 5.9, CSS Modules | หน้าจองผ่าน LIFF หน้าแอดมิน และ API ใน repository เดียว ใช้ Node.js 22 ขึ้นไป |
| Validation | Zod 4 | ตรวจ payload, query และ environment ก่อนเข้าชั้นบริการ |
| ฐานข้อมูล | Supabase PostgreSQL, Postgres.js, SQL migrations | เก็บร้าน ลูกค้า โต๊ะ คำขอ การจอง การจัดสรร ผังร้าน และ audit ใช้ SQL transaction กับ constraints คุมความจุและการจองซ้ำ |
| บัญชีและสิทธิ์ | LINE Login/LIFF SDK สำหรับลูกค้า, Supabase Auth สำหรับพนักงาน | ตรวจ LINE ID token ฝั่ง server และออก session รายร้าน พนักงานใช้สิทธิ์ owner หรือ staff ตาม `venue_members` |
| คิวจองหลัก | Postgres queue (`QUEUE_DRIVER=db`) | เก็บใน `booking_requests` และตัดสินผลด้วย `drain_booking_requests()` ตามลำดับที่คำขอ commit ต่อร้านและคืน |
| คิวทางเลือก | SQS FIFO, AWS SDK, Node.js worker, ElasticMQ ในเครื่อง | ใช้กลุ่มตามร้านและคืนบริการ ตัดสินตามลำดับที่ broker รับ และ ack หลัง DB commit |
| แจ้งเตือน | LINE Messaging API, Postgres outbox, Supabase Cron หรือ Vercel Cron | เก็บงานส่งคู่กับการเปลี่ยนสถานะจอง ใช้ lease และ LINE retry key กู้การส่งที่ล้มเหลว |
| Deploy | Vercel region `sin1`, Supabase cloud | เว็บและ API บน Vercel ใช้ Supabase transaction pooler พร้อม `DATABASE_PREPARE=false` ตามคู่มือ deploy |
| ทดสอบ | Vitest, Playwright (Python/Chromium), k6, GitHub Actions | ทดสอบกฎจองและ API กับฐานข้อมูล local ทดสอบ UI กับ mock backend และเก็บหลักฐานโหลดแยก |

## ทางเดินการจอง

1. `/` พาไป `/book/<slug>/login` ตาม `DEFAULT_VENUE_SLUG` ค่าเริ่มต้น `bookie-demo` เจ้าของแก้ slug และคัดลอกลิงก์หรือ QR จากหน้าแอดมินได้ เมื่อเปลี่ยน slug ให้ปรับ LIFF Endpoint URL และลิงก์ใน Rich Menu ให้ตรงกัน
2. ลูกค้าเข้า LINE login กรอกข้อมูลติดต่อ เลือกคืนที่เปิดรับ จำนวนคน และโซน วันพิเศษใช้เวลาเปิดเฉพาะคืน และหน้าจอแสดง countdown ก่อนเปิด
3. `POST /api/booking-requests` ตรวจสิทธิ์ ช่วงเปิดจอง และโควตา แล้วรับคำขอพร้อม `Idempotency-Key` การส่ง payload เดิมด้วย key เดิมคืน `requestId` เดิม เมื่อรับคำขอสำเร็จ API ตอบ `202` ลูกค้าติดตามผลด้วย status API
4. `process_booking_request()` ตรวจเงื่อนไขอีกครั้งใน SQL โหมดอัตโนมัติเลือกโต๊ะว่างที่เล็กที่สุดและรองรับกลุ่ม โหมดจัดสรรโดยร้านสร้าง `pending_allocation` พนักงานจัดสรรจาก `/admin/queue`
5. ลูกค้า LINE ถือการจองที่ยังใช้งานอยู่หรือคำขอที่กำลังตัดสินได้หนึ่งรายการต่อร้าน ยกเลิกแล้วจองใหม่ได้ตามเวลาเปิดจอง รายการที่พนักงานจองแทนได้รับการยกเว้นโควตา

ลิงก์ห้องรอเดิมพาไปหน้าเลือกคืนและโซน ตาราง ticket และข้อมูลย้อนหลังยังเก็บอยู่ กฎเปิดจองมาตรฐานอัปเดตทั้งวันเปิดและช่วงจองล่วงหน้าใน transaction เดียว โดยใช้ timezone ของร้าน [API contract](API_CONTRACT.md) · [เวลาเปิดจอง](BOOKING_OPENING.md)

## ลำดับคิวและการกู้คืน

ในโหมด `db` คำขอคืนเดียวกันได้ `queue_seq` ภายใต้ lock ที่ถือจน commit ตัว drain เลือกหัวคิวของแต่ละร้านและคืน ใช้ `FOR UPDATE SKIP LOCKED` และ commit ทีละรายการ การจัดสรรมี unique constraint ต่อโต๊ะและคืน API เริ่ม drain ผ่าน `after()` หลังตอบ และ Supabase Cron เป็นตัวสำรอง งาน `booking_housekeeping()` จัดการข้อมูลชั่วคราวตามรอบ

ในโหมด `sqs` worker กู้คำขอ `pending_publish` และต่อ visibility ระหว่างประมวลผล ทั้งสองโหมดใช้ SQL ตัดสินผลชุดเดียวกัน เมื่อใช้ retry ครบจะบันทึก `rejected/SYSTEM_ERROR` พร้อม audit [คู่มือ deploy](DEPLOY.md) · [หลักฐาน k6 ก่อนเปลี่ยนเป็น FCFS](evidence/README.md)

## LINE และการเฝ้าดูระบบ

- LINE Login/LIFF และ Messaging API ต้องอยู่ใต้ LINE provider เดียวกันเมื่อใช้ส่งแจ้งเตือนตามบัญชีลูกค้า ค่า credential แยกร้าน เก็บแบบเข้ารหัสฝั่ง server
- Outbox รองรับรับคำขอรอจัดสรร ยืนยันหรือจัดสรร ยกเลิก ปฏิเสธ เตือนการจอง ประกาศและเตือนวันพิเศษ ระบบ commit lease ก่อนเรียก LINE แล้วบันทึกผลตาม lease ปัจจุบัน การส่งและการจองจึงมีผลแยกกัน
- ใช้ scheduler เดียวเรียก `/api/internal/notifications/drain` แบบ POST จาก Supabase Cron หรือ GET จาก Vercel Cron ทั้งสองทางใช้ Bearer `CRON_SECRET` สถานะการส่งจริงขึ้นกับ token, การเปิด `LINE_NOTIFICATIONS_ENABLED` และ cron ที่ทำงาน
- `GET /api/health` แสดงจำนวนคำขอจองค้างและสรุป outbox ได้แก่ `pending`, `dead` และ `oldestPendingAgeSeconds` ตรวจหลักฐานการรับคำขอ ผลการตัดสิน และการยกเลิกจาก audit ตามสิทธิ์ร้าน

[LINE audit](LINE_NOTIFICATIONS.md) · [ตั้งค่าและตรวจ Cron](DEPLOY.md#5-booking-and-release-notifications-on-vercel)

## ทดสอบและขอบเขตงาน

`NEXT_PUBLIC_API_MODE=mock` ใช้ข้อมูล JSON สำหรับทดสอบหน้าจอ `real` เรียก API ที่ใช้ Postgres ส่วน `LINE_VERIFY_MODE=mock` ใช้กับการทดสอบในเครื่องและ CI โดย production ใช้ `real` [คู่มือทดสอบ](MOCK_TESTING.md)

GitHub Actions ทำงานทุก push และ pull request มี `check` สำหรับ typecheck, lint, unit และ build, `integration` ใช้ Supabase local + ElasticMQ และ `e2e` ใช้ Chromium บน mock production build รอบยืนยันงาน FCFS ที่ `6759f71` ผ่าน 106 unit tests, 51 integration tests และ 38 ขั้นตอน Playwright [คู่มือ Playwright](../e2e/README.md) · [ผล CI](https://github.com/tmno-O/bookie-booike/actions/runs/43915018630)

งานชำระเงิน มัดจำ คืนเงิน และ payout ยังอยู่ในแผน รวมถึง LINE webhook และการเผยแพร่ Rich Menu ผ่านระบบ ตอนเลือกระบบชำระเงิน ให้ทดสอบช่องทางจ่าย คืนเงิน และกรณีจ่ายหลังหมดเวลากันโต๊ะใน sandbox ก่อนเชื่อมเงินจริง
