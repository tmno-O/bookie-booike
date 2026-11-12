# Backend รายฟีเจอร์: Feature 1–4

5 พฤศจิกายน 2569 · ฉบับ Feature 1–4 + LIFF/FIFO | ผู้รับบทบาท: คุณ (Backend) | เอกสารออกแบบ ยังไม่มีระบบเปิดใช้งาน ไม่มีผล pilot/load test หรือธุรกรรมจริงที่ยืนยันแล้ว

> **อัปเดต 13 พ.ย. 2569:** ระบบจริงเลือก **DB queue** (`QUEUE_DRIVER=db`) เป็นคิวหลักหลังวัดผลเทียบกับ SQS FIFO. `sqs` ตามเอกสารนี้ (SQS FIFO + worker) ยังคงไว้เป็นทางเลือก. `db` เก็บคิวในตาราง Postgres แล้วตัดสินด้วย `drain_booking_requests()` ลำดับคิวจึงเป็นลำดับที่คำขอ commit ลงฐานข้อมูลแทนลำดับที่ broker รับ ใช้สำหรับ Vercel ที่รัน worker ไม่ได้. ดู [README](../../README.md) และ [DEPLOY](../DEPLOY.md).

ธุรกิจมี 4 ฟีเจอร์ตามไฟล์ใหม่ ส่วน 15 รายการในเอกสารก่อนเป็นความสามารถทางเทคนิคประกอบ ไม่ใช่การเพิ่ม scope ธุรกิจใหม่ อ่าน [FEATURE_REQUIREMENTS.md](./FEATURE_REQUIREMENTS.md) และ [OPEN_DECISIONS.md](./OPEN_DECISIONS.md) ควบคู่

## F1. LINE integration / onboarding

**ใช้:** LINE OA/LIFF/Messaging API, Next.js, encrypted secret storage, QR renderer และ image template generator

**ทำ:** เก็บ onboarding choice/capabilities ต่อร้าน สร้าง URL/QR จาก LIFF ID ที่ตั้งแล้ว เก็บเมนูเดิมโดยไม่ mutation เทมเพลตสร้าง/ตั้ง default เฉพาะหลัง preview/ยืนยัน ตรวจ provider/channel/destination และบอทเดิมก่อนเปิด messaging

**เหตุผล:** การใช้ OA ร้านลดแรงต้าน onboarding แต่เพิ่มงาน multi-tenant credentials/identity ต้องแยก link-only กับ full messaging ไม่สัญญาส่งการ์ดจาก token ที่ยังไม่เชื่อม

**ข้อมูล/API ที่เสนอ:** venue_line_integrations, onboarding_choices, rich_menu_jobs, customer_identities; /api/staff/venues/{venueId}/line-integration, /booking-link, /rich-menu-preview, /rich-menu-publish
## F2. Venue / zones / tables / rules

**ใช้:** PostgreSQL, Supabase Auth/Storage, Zod, effective-rule SQL/service และ staff API

**ทำ:** ตั้งชื่อร้าน Maps โซน โต๊ะ optional price รูปผังประกอบ กฎวัน/ช่วงเวลา/ล่วงหน้า/ปิดระดับโซนและโต๊ะ Validated ownership ก่อนอัปโหลด/แก้ทุกครั้ง List โต๊ะที่เลือกได้เรียงใต้โซน โต๊ะปิดซ่อน โต๊ะไม่ว่างกดไม่ได้แต่ worker ตรวจซ้ำ

**เหตุผล:** UI ไม่ใช่ตัวบังคับกฎจริง ต้องใช้ effective rules/policy version ชุดเดียวกันใน availability/customer/staff/worker ราคาโต๊ะและมัดจำเป็นคนละ field ไม่สรุปว่าต้องเรียกเก็บรวมจนเลือก D01

**ข้อมูล/API ที่เสนอ:** venues, zones, venue_tables, booking_rules, table_rule_overrides, service_nights, booking_releases, asset_metadata; /zones, /tables, /rules, /assets, /releases
## F3. Staff-assisted booking / known customers

**ใช้:** Supabase Auth, venue_members, tenant-scoped customer index, SQS FIFO, booking RPC และ notification outbox

**ทำ:** พนักงานเลือกโต๊ะ ลูกค้าที่ร้านรู้จัก และวันเวลา แสดงสรุป/ข้อมูลแยกชื่อซ้ำ ส่งเข้าคิวกลุ่มเดียวกับลูกค้า กำหนด actor/source จาก server เมื่อสำเร็จให้ลูกค้าเห็นรายการและส่งจาก OA ร้าน เก็บผลการส่งที่ตรวจได้

**เหตุผล:** display name ไม่ใช่ unique ID ค้นเฉพาะลูกค้าร้านและ identity provider ที่ถูกต้อง พนักงานไม่ลัดคิว การส่งข้อความล้มเหลวไม่ยกเลิก booking; guest/confirmation เพิ่มเติมยังรอเลือก

**ข้อมูล/API ที่เสนอ:** venue_customers, customer_identities, booking_requests, audit_logs, notification_outbox; GET /api/staff/venues/{venueId}/customers, POST /booking-requests, GET /bookings
## F4. Deposit policy / payment / refund

**ใช้:** Payment provider adapter, sandbox, PostgreSQL transaction/RPC, webhook inbox, refund worker และ Cron

**ทำ:** snapshot โหมด/ยอด/basis/cutoff เมื่อสร้าง hold ตรวจ payment จาก providerก่อนยืนยัน คำนวณสิทธิ์คืนจากเหตุผลยกเลิก/เวลา สร้าง refund request แบบ idempotent ตรวจผลจริงก่อน refunded ร้านยกเลิก/ไม่มีโต๊ะให้คืนเต็มทุก paid mode

**เหตุผล:** การรับเงิน การได้สิทธิ์คืน และการโอนคืน/payout เป็นคนละเหตุการณ์ ต้องรับ duplicate/late/out-of-order ได้ ไม่อ้างโอนคืนหรือ escrow สำเร็จจากการแก้ status ภายใน

**ข้อมูล/API ที่เสนอ:** deposit_policies, policy_snapshots, payment_attempts, payments, payment_events, refund_requests, refund_events, payout_records; /api/payments, /webhooks/payments/{provider}, /me/bookings/{id}/cancellation-preview, /cancel

## ระบบสนับสนุนที่ทุกฟีเจอร์ใช้ร่วมกัน

| ความสามารถ | เครื่องมือ / วิธีทำ | เหตุผล |
| --- | --- | --- |
| Identity | LINE raw token verify + customer session; Supabase staff session | ป้องกันปลอมตัวและข้ามร้าน ไม่เชื่อ userId จาก browser |
| Validation | TypeScript + Zod | Types ระหว่างพัฒนาและ schema ตอน runtime ไม่แทน authorization |
| Draft | React state/sessionStorage เฉพาะตัวเลือกไม่อ่อนไหว | เตรียมก่อนเปิดขาย ไม่ hold/ไม่ให้คิว ไม่เก็บ secrets/PII ลง draft browser |
| เวลาเปิดขาย | booking_releases + server time | แยกจากเวลาให้บริการจริงและ timezone ของร้าน |
| รับคำขอ | Next.js API + admission registry + SQS publish | คืน 202/requestId หลัง broker รับ ไม่รอ payment/LINE |
| FIFO | SQS MessageGroupId ต่อ venue/service_night + worker | ใคร broker รับก่อนถูกพิจารณาก่อนภายในกลุ่ม Staff ใช้กลุ่มเดียวกัน |
| กันซ้อน | SQL RPC + row lock + unique/exclusion constraints | บังคับที่ DB และผูกโต๊ะ/โซน/คืนให้เป็นร้านเดียวกัน |
| กดซ้ำ/ระบบหยุด | Idempotency hash + durable result + visibility/lease/fencing | retry identity เดิมไม่ทำ booking/payment/outbox ซ้ำหรือข้ามคิว |
| สถานะคิว | Owner-scoped status API + polling/backoff/jitter | ติดตามหลัง refresh ไม่แปลว่า accepted เท่ากับได้โต๊ะ |
| Hold/no-show | Cron + SQL ตรวจเวลาในเส้นทางสำคัญด้วย | ปิดแอปแล้วยังทำงาน ไม่ปล่อย checked_in จาก late timer |
| ยกเลิก/คืน | Refund entitlement engine + provider adapter | สิทธิ์คืนตาม snapshot และโอนจริงตรวจจาก provider |
| ข้อความ | Outbox + Edge Function + OA credentials ต่อร้าน | ไม่ขวาง FIFO booking และไม่ย้อน booking เมื่อส่งไม่ได้ |
| Check-in | Opaque QR token hash + staff RPC แบบ atomic | สแกนซ้ำได้เวลาเดิม ไม่เผย PII/ข้อมูลข้ามร้าน ไม่แทนตรวจอายุหน้าร้าน |
| รับโหลด | Rate limit shared state, bounded worker, pool, cache เมื่อจำเป็น | คิวไม่ทำให้ ingress/DB มีทรัพยากรไม่จำกัด |
| ทดสอบ/ติดตาม | Vitest/PostgreSQL/k6 + structured logs/metrics | พิสูจน์ onboarding rules refund FIFO failures และ capacity ตามจริง |


## การรับคิวและความเร็ว

API ตรวจสิทธิ์/schema/เวลา/rate limit สร้างหรืออ่าน admission request เดิม ส่ง SQS โดย request identity คงที่ คืน 202 หลัง broker รับสำเร็จ ขั้นนี้ยังไม่ได้โต๊ะ Status API คืน queued/processing/held/confirmed/rejected; หาก worker พบโต๊ะไม่ว่างให้ rejected/TABLE_UNAVAILABLE ไม่ย้อน response เก่าเป็น 409

SQS จัดลำดับตาม broker acceptance ต่อกลุ่ม ไม่ใช้ timestamp มือถือ/LINE หรือเลข DB ที่ออกก่อน publish เป็นคิว Worker สรุปรายการก่อนหน้าก่อนเดินต่อ ไม่ parallel commit ในกลุ่มแม้รับ batch ส่วนคนละกลุ่มทำขนานได้ Hold เริ่มตอน worker กันโต๊ะสำเร็จ ไม่เริ่มตอนรอคิว และ worker ไม่รอให้คนหนึ่งจ่ายเสร็จก่อนทำคนถัดไป

Registry กับ SQS ไม่ใช่ transaction เดียว ต้องมี pending_publish/reconcile เมื่อ broker รับแล้ว API timeout หรือตรงกันข้าม Ack/delete หลัง DB commit ตั้ง visibility/lease/fencing กัน redelivery/worker เก่าทำผลซ้ำ SQS dedup 5 นาทีไม่แทน DB idempotency ระยะยาว งานเสียที่หัวคิวต้อง pause/quarantine ตามกติกา ไม่ข้ามเงียบ ๆ

ลำดับ SQS ภายในไม่ใช่เลขจำนวนคนข้างหน้า MVP แสดงรหัสติดตาม/สถานะก่อน หากเพิ่มตำแหน่งคิวต้องมี read model แยก ขนาดโหลดจริงยังไม่ทราบ ต้องทดสอบ k6 ก่อนสัญญาว่าเร็วระดับใด

## กฎเวลาและการเปิดรับ

F2 ให้ตั้งกฎระดับโซน/โต๊ะ แต่ priority, min notice/max advance, capacity และหลายรอบยังไม่ตัดสินทั้งหมด ออกแบบ effective_rule(version) ให้ availability และ RPC ใช้เดียวกัน ก่อนนำร่องต้องปิด D01–D06 ไม่ใส่ค่าเดาเป็นกติกาตกลงแล้ว

เสนอใช้ service_date เป็นวันที่เริ่มคืนบริการ เก็บเวลาจริง timestamptz เช่น ตัวอย่างทดสอบคืน 5 พ.ย. 19:00 ถึง 6 พ.ย. 01:00 มาถึง 6 พ.ย. 00:15 ยังอยู่คืน 5 พ.ย. เวลานี้ไม่ใช่คำแนะนำเวลาเปิดตามกฎหมาย

ราคาโต๊ะ optional/null แสดงจองฟรีตาม F2 ส่วนมัดจำมี mode/amount/basis ของ F4 แยกกัน การปิดโซน/โต๊ะหยุดขายใหม่ ไม่ควรลบ booking เดิมหรือคืนเงินโดยเงียบ ๆ เป็นข้อเสนอให้ทีมยืนยัน

## การหมดเวลาและ no-show

Check-in และรายการประจำวันยังรอตัดสินใจ D16 ตามสไลด์นำเสนอ ส่วนนี้เป็นข้อเสนอ ไม่ใช่ขอบเขต Phase 1 ที่ตกลงแล้ว หากไม่เก็บสถานะมาถึงที่เชื่อถือได้ ต้องปิด arrival auto-release

payment hold expiry ใช้กับ pending_payment เท่านั้น หากทีมเลือก check-in และ arrival auto-release จึงใช้ arrival deadline/grace กับ confirmed ที่ยังไม่ checked_in ให้ job ล็อกแถวเดียวกับ check-in ตรวจสถานะซ้ำก่อน mark no_show/ปล่อยโต๊ะ/คำนวณสิทธิ์เงิน ไม่มี auto-release ของ checked_in หรือการแปล paid ว่าโอนเข้าร้านแล้ว

## ความพร้อมของเงินจริง

ทำ 3 โหมดและ refund engine ใน sandbox ได้ แต่ไฟล์ต้นทางยังไม่เลือก Gateway หรือ A/B/C ของเส้นทางเงิน จึงยังไม่เปิดเงินจริงโดยอ้างแผนเดิม Omise PromptPay ไม่ refund ผ่าน API ของ Omise ต้องมี external refund workflow หากเลือกเจ้านี้ Stripe PromptPay ระบุ refund/Connect แต่ยังต้องตรวจรูปแบบ marketplace, merchant onboarding และ payout timing ที่ต้องการ

สถานะ paid_unallocated เป็นเงินเข้าที่ไม่มีโต๊ะ ไม่ยืนยันกลับอัตโนมัติ ทุกการคืนมี unique operation key/หลักฐาน/success event การกดขอคืนหรือ provider accepted ไม่เท่ากับเงินกลับแล้ว

## อ้างอิงและต้นทุน

[COST_PLAN.md](./COST_PLAN.md) มีราคา SQS/free tier/ตัวอย่างจำนวน requests และต้นทุน worker ที่แยกกัน [LINE_ONBOARDING_GUIDE.md](./LINE_ONBOARDING_GUIDE.md) มีข้อจำกัดเมนูและ provider ที่ตรวจแล้ว

[SQS FIFO](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-understanding-logic.html), [LINE user IDs](https://developers.line.biz/en/docs/messaging-api/getting-user-ids/), [Rich Menu](https://developers.line.biz/en/docs/messaging-api/rich-menus-overview/), [Omise](https://docs.omise.co/promptpay), [Stripe](https://docs.stripe.com/payments/promptpay) ตรวจ 5 พฤศจิกายน 2569
