# Bookie Bookie

อัปเดต 17 พฤศจิกายน 2569 · โค้ด FCFS และ CI รวมใน PR #22 · [Repository](https://github.com/tmno-O/bookie-booike)

Bookie Bookie ให้ลูกค้าจองโต๊ะผ่าน LINE ของร้าน และให้ร้านจัดการจอง ยกเลิก จัดสรร และเช็กอินจากหน้าหลังบ้าน ทีมเปิดระบบบน Vercel และ Supabase พร้อมเชื่อม LINE Login/LIFF แล้ว ส่วนสถานะ migrations ล่าสุดและการส่งแจ้งเตือนจริงตรวจตาม [คู่มือ deploy](DEPLOY.md)

## ลูกค้าจองอย่างไร

1. หน้าแรกพาไปหน้า LINE Login ของร้านเริ่มต้น หรือเปิด LIFF จาก Rich Menu ของร้าน
2. กรอกชื่อและเบอร์ เลือกคืนที่เปิดรับ จำนวนคน และโซน หน้าเลือกคืนแสดง countdown สำหรับคืนที่ยังไม่เปิด
3. ส่งคำขอได้จากหน้าเลือกโซนโดยตรง ระบบรับเข้าคิว Postgres และตัดสินตามลำดับ commit ต่อร้านและคืน
4. ดูผลพร้อมเลขอ้างอิงที่หน้า Confirmed หรือตรวจและยกเลิกตามนโยบายใน **การจองของฉัน**

ลูกค้า LINE มีการจองที่ยังใช้งานได้หนึ่งรายการต่อร้าน หรือมีคำขอที่กำลังประมวลผลหนึ่งรายการ การยกเลิกคืนสิทธิ์จองใหม่ รายการที่พนักงานจองแทนได้รับการยกเว้น ลิงก์ห้องรอและคิวลูกค้าเดิมพาไปหน้าเลือกคืน ส่วนคิวจัดสรรของพนักงานยังใช้งานที่ `/admin/queue`

## ร้านทำอะไรได้

- Owner และ staff ใช้ Supabase Auth ดู dashboard ค้นชื่อ เบอร์ หรือเลขจอง จองแทน จัดสรรโซน ยกเลิก และเช็กอินตามสิทธิ์ร้าน
- Owner ตั้งเวลาเปิดจองมาตรฐาน วันพิเศษ วันปิดร้าน เวลาบริการ นโยบายยกเลิก และข้อความเตือน
- Owner ตั้ง slug คัดลอกลิงก์หรือ QR สำหรับ Rich Menu และเผยแพร่ผังโซน เจ้าของตั้งค่าการเชื่อม LINE และบันทึกคำเชิญพนักงาน
- ร้านเลือกจัดโต๊ะอัตโนมัติหรือให้พนักงานจัดสรรได้ กลุ่ม 12+ ใช้การจัดสรรโดยร้านเมื่อเปิดรับ

## สถาปัตยกรรมและหลักฐานการจอง

Next.js App Router บน Vercel รับคำขอผ่าน API และบันทึกลง `booking_requests` ใน Supabase Postgres โหมด production ใช้ `QUEUE_DRIVER=db` เมื่อ commit สำเร็จ API ตอบ `202` พร้อม request ID ให้ติดตามผล ตัว drain เริ่มหลังตอบ และ Supabase Cron ช่วยเก็บคำขอที่ยังค้าง

SQL ล็อกลำดับคำขอและล็อกการจัดสรรต่อร้านและคืน มี unique constraint กันโต๊ะซ้ำ `Idempotency-Key` เดิมกับข้อมูลเดิมคืนคำขอเดิม payload ต่างกันได้ `422 IDEMPOTENCY_CONFLICT` Rate limit นับตามผู้ส่งต่อร้าน

การตัดสินเก็บผล ลำดับคิว เวลา และหลักฐาน audit ต่อร้าน หน้าแอดมินตรวจ hash chain และเจ้าของส่งออก CSV ได้ ใบจองลูกค้ามีรหัสย่อสำหรับเทียบหลักฐานในร้าน [Tech Stack](TECH_STACK_PLAN.md) · [API contract](API_CONTRACT.md)

## LINE และเวลาเปิดจอง

เวลาเปิดจองใช้ timezone ร้าน ค่ามาตรฐานกำหนดทั้งเวลาเปิดและจำนวนวันล่วงหน้าใน transaction เดียว วันพิเศษใช้เวลาเปิดเฉพาะคืนภายในช่วงที่อนุญาต [คู่มือเวลาเปิดจอง](BOOKING_OPENING.md)

LINE outbox รองรับรับคำขอรอจัดสรร ยืนยัน ยกเลิก ปฏิเสธ เตือนจอง และประกาศวันพิเศษ งานส่งใช้ retry key และ lease แยกจาก transaction การจอง `/api/health` แสดงยอดคิวและ outbox ค้าง การทดสอบ CI ใช้ LINE จำลอง การยืนยันว่าข้อความเข้าจริงใช้บัญชีทดสอบบนมือถือ [LINE audit](LINE_NOTIFICATIONS.md)

## การทดสอบและหลักฐาน

ผลบน `main` ที่ `44b8c61` ผ่าน 106 unit tests, 51 integration tests และ 38 ขั้นตอน Playwright รวม typecheck, lint และ build [ผล GitHub Actions](https://github.com/tmno-O/bookie-booike/actions/runs/43920496169) · [หลักฐานสำหรับนำเสนอ](evidence/README.md)

ผล k6 5,000 คำขอและภาพ audit เป็นหลักฐานจากรุ่นก่อน FCFS บนระบบ local มี commit และเงื่อนไขกำกับ [ผล k6](evidence/README.md#ผลย้อนหลังของ-k6)

## ขอบเขตและเอกสาร

การชำระเงิน มัดจำ คืนเงิน ระบบเก็บค่าสมาชิก การเผยแพร่ Rich Menu ผ่านระบบ และการคืนโต๊ะอัตโนมัติเมื่อไม่มาอยู่ในแผน

| ต้องการดู | เอกสาร |
| --- | --- |
| รันในเครื่องและใช้ CI | [README](../README.md), [Mock testing](MOCK_TESTING.md), [Playwright](../e2e/README.md) |
| สเปกและสถาปัตยกรรม | [SRS](SRS_Bookie_Bookie.md), [Tech Stack](TECH_STACK_PLAN.md), [API contract](API_CONTRACT.md) |
| Deploy และตรวจส่ง LINE | [Deploy](DEPLOY.md), [LINE audit](LINE_NOTIFICATIONS.md) |
| ภาพอธิบายและสไลด์ | [Explainer](Bookie-Bookie-Explainer.html), [Pitch Deck](Bookie-Bookie-Pitch-Deck.html) |
| หลักฐานทดสอบ | [CI, Playwright และ k6](evidence/README.md) |
| เอกสารแผนและบันทึกย้อนหลัง | [Backend plan](backend/BACKEND_PLAN.md), [Feature stack](backend/BACKEND_FEATURE_STACK.md), [Backend 1](backend-dev-1.md), [Backend 2](backend-dev-2.md), [Backend 3](BACKEND_DEV_3_IMPLEMENTATION.md) |
| เอกสารต้นฉบับ | [URS](Bookie_Bookie_URS_.pdf), [Sprint Plan](Bookie_Bookie_Sprint_Plan.docx), [แผน Backend ต้นฉบับ](<backend/เอกสาร Backend.pdf>) |
