# Tech Stack: Bookie Lyon ฉบับ Feature 1–4

5 พฤศจิกายน 2569 · ฉบับ Feature 1–4 + LIFF/FIFO | เอกสารออกแบบ ยังไม่มีระบบเปิดใช้งาน ไม่มีผล pilot/load test หรือธุรกรรมจริงที่ยืนยันแล้ว

> **อัปเดต 13 พ.ย. 2569:** ระบบจริงเลือก **DB queue** (`QUEUE_DRIVER=db`) เป็นคิวหลักหลังวัดผลเทียบกับ SQS FIFO. `sqs` ตามเอกสารนี้ (SQS FIFO + worker) ยังคงไว้เป็นทางเลือก. `db` เก็บคิวในตาราง Postgres แล้วตัดสินด้วย `drain_booking_requests()` ลำดับคิวจึงเป็นลำดับที่คำขอ commit ลงฐานข้อมูลแทนลำดับที่ broker รับ ใช้สำหรับ Vercel ที่รัน worker ไม่ได้. ดู [README](../README.md) และ [DEPLOY](DEPLOY.md).

แนะนำ LINE OA รายร้าน + LIFF, TypeScript/Next.js API, Supabase PostgreSQL/Auth/Storage, SQS FIFO และ Node.js worker แยก สำหรับ Gateway ใช้ adapter และ sandbox ก่อน ยังไม่เลือกผู้ให้บริการหรือเส้นทางเงินจริง

รายละเอียดขอบเขตที่ตัดสินใจแล้วอยู่ [FEATURE_REQUIREMENTS.md](./FEATURE_REQUIREMENTS.md) ข้อเสนอ/คำถามค้างอยู่ [OPEN_DECISIONS.md](./OPEN_DECISIONS.md) ไม่ถือว่าเครื่องมือที่แนะนำเป็นระบบที่ติดตั้งแล้ว

## เครื่องมือและเหตุผล

| ส่วน | ใช้ | หน้าที่และเหตุผล |
| --- | --- | --- |
| LINE รายร้าน | LINE OA / LIFF SDK / Messaging API | ใช้แบรนด์และเมนูเดิมของร้าน เชื่อม token/provider แยกร้าน |
| เว็บ/API | Next.js App Router + TypeScript + Node.js runtime | เว็บ LIFF และ staff ใช้ repository เดียว API สั้น รับคิวและ webhook |
| Validation | Zod | ตรวจรูปแบบข้อมูลและ environment; สิทธิ์/โต๊ะว่างยังตรวจ server/SQL |
| ข้อมูล | Supabase PostgreSQL + SQL migrations/RPC | transaction และ constraints ป้องกันขายโต๊ะซ้ำ รักษา schema/version |
| บัญชีร้าน | Supabase Auth + venue_members | ตรวจ owner/staff ต่อร้าน ไม่ใช้แค่ login แล้วแก้ได้ทุก venue |
| อัปโหลด | Supabase Storage + image processing | โลโก้/รูปผังประกอบ ตรวจชนิด/ขนาดและ ownership ไม่เก็บรูปใน booking row |
| คิวจอง | SQS FIFO + AWS SDK | ลำดับ broker acceptance ตาม venue/service_night จองแทนไม่ลัดคิว |
| ประมวลผล | Node.js/TypeScript worker ใน container | ทำตามลำดับในกลุ่ม เรียก SQL แล้ว ack หลัง commit จำกัดงานเข้าฐานข้อมูล |
| มัดจำ | Payment adapter + sandbox provider | จำลอง 3 โหมดและ refund engine เลือกเงินจริงหลังตรวจ refund/merchant/payout |
| งานตามเวลา | Supabase Cron + SQL functions | หมด hold/no-show ที่เปิดใช้/reconcile ตรวจเวลาซ้ำภายใต้ lock |
| ส่ง LINE | Notification outbox + Edge Function | ใช้ credentials OA ร้านตาม booking ทำ retry ไม่ขวางคิวจอง |
| หน้าจอข้อมูล | React state + fetch/TanStack Query ตามจำเป็น | Draft ไม่ hold; status polling มี backoff/jitter ไม่ยิงหนักพร้อมกัน |
| ทดสอบ | Vitest + PostgreSQL integration + k6 | กฎหลายระดับ คืนเงิน FIFO failure และ spike; มือถือจริงแยกจาก mock |
| Deploy | Vercel + Supabase + worker hosting ที่เลือก | แยก web/API worker และ notification runtime เพิ่ม Redis/Waiting Room เมื่อจำเป็น |


## ทางเดินระบบ

1. OA ร้านเปิด LIFF URL ที่ลงทะเบียน/ผูก provider ถูกต้อง ไม่แก้ Rich Menu ในโหมดเก็บเมนูเดิม
2. LINE ID token ตรวจฝั่ง server ออก session ต่อ identity/provider/venue ที่เกี่ยวข้อง
3. อ่านกฎเปิดรับที่คำนวณแล้ว เลือกวันเวลา โซน ปุ่มชื่อโต๊ะ จำนวนคน ข้อมูลติดต่อ Draft ไม่มีลำดับสิทธิ์
4. กดยืนยันผ่าน API โดยตรง ตรวจ session/schema/เวลา/rate limit แล้วส่ง SQS รับสำเร็จจึงคืน 202/requestId
5. Worker ทำตาม FIFO ต่อร้าน/คืน ตรวจ effective rule/ราคา/policy จาก server แล้วเรียก booking RPC
6. ไม่มัดจำ: confirmed พร้อม outbox; มีมัดจำ: pending_payment + hold เริ่มตอนกันโต๊ะสำเร็จ ตรวจ provider แล้วค่อย confirmed
7. ยกเลิก: SQL คำนวณ refund entitlement จาก snapshot แยกการคืนเงินจริงออกเป็นงานที่ตรวจสอบได้
8. ส่งการ์ดจาก OA ร้าน การส่งไม่ได้ไม่ย้อน booking ลูกค้าดูใน LIFF ได้

## การเชื่อม OA ที่สำคัญกว่าการเปลี่ยน framework

Provider ของ LINE Login/LIFF กับ Messaging API ต้องจับคู่ถูกก่อนส่งข้อความ full integration เสนอ configuration รายร้านภายใต้ provider ของร้านเอง ใช้เว็บ platform เดียวร่วมกันได้ Link-only จาก OA ใดก็ได้ไม่แปลว่าใช้ platform LINE subject ส่งผ่าน OA ต่าง provider ได้ อ่าน [LINE_ONBOARDING_GUIDE.md](./LINE_ONBOARDING_GUIDE.md)

เก็บ channel secret/access token แบบจำกัดสิทธิ์ต่อ venue ตรวจ destination/channel ใน webhook ไม่เชื่อ venue_id จาก payload อย่างเดียว ไม่เปิดเผย token ผ่าน NEXT_PUBLIC_ และไม่ทับ webhook บอทเดิมโดยไม่ประสานงาน

## SQL และ FIFO

ใช้ row lock, unique active โต๊ะ/คืน และ exclusion constraint บนช่วงครองโต๊ะพร้อม foreign keys ผูก venue ให้ตรงกัน หนึ่งโต๊ะต่อคืนเป็นขอบเขตที่เสนอจากแผนเดิม รอยืนยันการนั่งหลายรอบก่อนเปลี่ยนกฎ

SQL RPC บันทึก booking/allocation/result/idempotency/outbox ที่เกี่ยวข้องพร้อมกัน กดซ้ำ/ส่งซ้ำกลับผลเดิม เมื่อโต๊ะไม่ว่าง worker ให้ rejected/TABLE_UNAVAILABLE; status API ตอบผลหลัง 202 ไม่ย้อน HTTP response เก่า

SQS deduplication ช่วง 5 นาทีไม่แทน idempotency ของ DB Registry กับ broker ไม่ใช่ transaction เดียว ต้องกู้กรณี pending_publish และ broker รับแล้ว API timeout Worker อ่าน batch แล้วต้องทำเรียงในกลุ่ม มี visibility/lease/fencing และ ack หลัง DB commit งานแรกเสียต้อง pause/แก้ตามกติกา ไม่ข้ามไปท้ายแล้วอ้าง FIFO

ไม่เรียก payment/LINE API ค้างใน transaction หรือรอการชำระเงินก่อนเดินคิวต่อ คนละร้าน/คืนขนานได้ คนที่เข้าหน้าจอก่อนยังไม่ได้สิทธิ์

## เงินและการคืน

สามโหมดตาม F4 เป็นข้อกำหนดธุรกิจ Gateway ยังไม่เลือก Omise PromptPay คืนผ่าน Omise ไม่ได้ จึงไม่ตั้งเป็นค่าเริ่มต้นของ flow คืนอัตโนมัติ Stripe PromptPay ระบุรองรับ refund/Connect แต่ยังต้องตรวจ account, รูปแบบ marketplace และ payout จริง ไม่ถือว่ารองรับ escrow ตามที่ต้องการแล้ว

แยก paid, refund eligibility, refund requested/succeeded และ payout status ทุกโหมดที่ร้านยกเลิก/จัดโต๊ะไม่ได้ต้องมีสิทธิ์คืนเต็มตามนโยบาย เงินเข้าหลัง hold หมดเป็น paid_unallocated ห้ามแย่งโต๊ะคืน

## ความเหมาะสมกับ Hackathon

คิว FIFO เหมาะกับโจทย์เปิดรับพร้อมกัน ค่า SQS สำหรับ pilot เล็กอาจอยู่ส่วนฟรี แต่ IAM/worker/recovery/testing ใช้เวลา ดู [COST_PLAN.md](./COST_PLAN.md) ราคา Singapore FIFO USD 0.50 ต่อ 1 ล้านที่คิดเงิน และฟรี 1 ล้าน requests/เดือนตามเงื่อนไขที่ตรวจ 5 พ.ย. 2569

จำกัดก่อน: onboarding 3 ทาง, กฎหลัก, staff known customers, มัดจำ 3 โหมด sandbox, FIFO หนึ่งกลุ่มต่อ inventory, tests กรณีเสี่ยง ไม่ลงทุน full Rich Menu editor/ผังโต้ตอบก่อนปิด provider/payment decisions

## อ้างอิง

[SQS pricing](https://aws.amazon.com/sqs/pricing/), [AWS Price List](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSQueueService/current/ap-southeast-1/index.json), [FIFO](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-understanding-logic.html), [LINE menu](https://developers.line.biz/en/docs/messaging-api/rich-menus-overview/), [LINE IDs](https://developers.line.biz/en/docs/messaging-api/getting-user-ids/), [PostgreSQL](https://www.postgresql.org/docs/current/rangetypes.html), [Omise PromptPay](https://docs.omise.co/promptpay), [Stripe PromptPay](https://docs.stripe.com/payments/promptpay) ตรวจ 5 พ.ย. 2569
