# หลักฐานการทดสอบ Bookie Bookie

## ผล CI บน main

ผลที่ตรวจแล้วหลัง PR #23 ที่ commit `44b8c61` [GitHub Actions](https://github.com/tmno-O/bookie-booike/actions/runs/43920496169)

| ชุด | ผล | หลักฐานสำหรับนำเสนอ |
| --- | --- | --- |
| check | 106 unit tests พร้อม typecheck, lint และ build | [ผล CI](https://github.com/tmno-O/bookie-booike/actions/runs/43920496169) |
| integration | 51 tests จาก 4 ไฟล์ | [เปิด job integration แล้วเลือก Run npm run test:integration](https://github.com/tmno-O/bookie-booike/actions/runs/43920496169/job/133486163790) |
| e2e | 38 ขั้นตอน | [รายงานและภาพ Playwright](https://github.com/tmno-O/bookie-booike/actions/runs/43920496169/artifacts/14253722072) |

Integration ใช้ Supabase local ลง migrations จริง และจำลองผลตอบกลับจาก LINE

- API และคิว 20 เคส [booking.test.ts](../../tests/integration/booking.test.ts)
- คิว Postgres 11 เคส [db-queue.test.ts](../../tests/integration/db-queue.test.ts)
- กฎร้านและ audit 12 เคส [policies.test.ts](../../tests/integration/policies.test.ts)
- LINE outbox, reminder และ retry 8 เคส [notification-scenarios.test.ts](../../tests/integration/notification-scenarios.test.ts)

ให้อาจารย์ดูผล `51 passed` คู่กับเคส 50 คำขอแย่งโต๊ะสุดท้าย ซึ่งยืนยันหนึ่งรายการและปฏิเสธ 49 รายการ. ให้ร้านดูภาพจองสำเร็จ ยกเลิก แล้วจองใหม่ หรือเดโมบนมือถือด้วยบัญชีทดสอบหากต้องการพิสูจน์ข้อความเข้าแชต. Repository เป็น private จึงใช้ภาพสรุป CI หรือภาพเดโมสำหรับผู้ชมที่ไม่มีสิทธิ์เข้าถึง.

## ผลย้อนหลังของ k6

ผลด้านล่างเก็บจากโค้ดก่อนเปลี่ยนเป็น FCFS และรันในเครื่อง.

ทดสอบเมื่อ 12 พฤศจิกายน 2569 ที่ commit `6f3f359` (branch `chore/deploy`) ด้วยสคริปต์ [`tests/load/booking-burst.js`](../../tests/load/booking-burst.js)

**สรุป:** ทั้งสองโหมดจองโต๊ะได้ถูกต้อง คือ 5,000 คำขอแย่งโต๊ะเดียว ได้ `confirmed` แค่ 1 รายการ ไม่มี oversell แต่โหมดคิวใน DB (`QUEUE_DRIVER=db`) รับคำขอครบทั้ง 5,000 รายการโดยไม่มี error เร็วกว่าโหมด SQS ประมาณ 6 เท่า และตัดสินผลครบ 0.11 วินาทีหลังคำขอสุดท้าย

## ผลเทียบสองโหมด

| ตัวชี้วัด | SQS + worker | คิวใน DB |
| --- | --- | --- |
| คำขอที่ส่ง | 5,000 | 5,000 |
| ได้ HTTP 202 (รับเข้าคิว) | 4,714 | **5,000** |
| HTTP error (timeout 90 วินาที) | 286 (5.49%) | **0** |
| เวลารับคำขอครบ | 403 วินาที | **68.5 วินาที** |
| อัตรารับ | 11.9 คำขอ/วินาที | **65.8 คำขอ/วินาที** |
| Latency POST median / p95 | 5.33 / 89.99 วินาที | **3.45 / 4.41 วินาที** |
| ตัดสินครบหลังคำขอสุดท้าย | ค้าง 841 รายการนานกว่า 28 นาที (ดูหมายเหตุ) | **0.11 วินาที** |
| ผลการจอง | confirmed 1, rejected 4,999 | confirmed 1, rejected 4,999 |

## เงื่อนไขการทดสอบ

- เครื่องเดียว (Windows, Docker): Supabase local, ElasticMQ (ตัวจำลอง SQS) และ Next.js `next dev` ทั้งคู่
- ร้าน `bookie-demo` โต๊ะ A2 (4 ที่นั่ง) คืนละหนึ่งคืนที่ยังว่าง: SQS ใช้คืน 28 พ.ย. 2569, DB ใช้คืน 30 พ.ย. 2569
- 200 บัญชี LINE mock แต่ละบัญชีส่ง 25 คำขอ ส่งพร้อมกันสูงสุด 250 คำขอ timeout ต่อคำขอ 90 วินาที
- DB connection pool ของแอป `max: 10` เท่ากันทั้งสองโหมด
- k6 v2.3.0 ผ่าน Docker image `grafana/k6`

## หมายเหตุที่ต้องบอกผู้ชม

- **ตัวเลขนี้เป็นการเทียบระหว่างสองโหมดบนเครื่องเดียวกัน ไม่ใช่ความเร็วจริงบน cloud** เพราะ `next dev` ช้ากว่า production และทุกบริการแย่งทรัพยากรเครื่องเดียวกัน
- โหมด SQS ใช้ ElasticMQ ซึ่งเป็นตัวจำลองในเครื่อง ไม่ใช่ AWS SQS จริง ระหว่างทดสอบ worker ตัดสินผลได้ช้าลงมาก (ราว 0.6 รายการ/วินาที ช่วงท้าย) จน 841 รายการยังค้างหลังรอ 28 นาที
- **SQS ค้างไป 813 รายการถูกตัดสินระหว่างที่รันโหมด DB** เพราะ drain ของโหมด DB หยิบทุกแถวที่สถานะ `queued` ในฐานข้อมูลเดียวกัน ([`sqs/db-result-final.txt`](sqs/db-result-final.txt) แยกจำนวนไว้: worker ตัดสิน 4,187 รายการก่อนเริ่มโหมด DB) ผล confirmed 1 / rejected 4,999 ของ SQS จึงมาจากทั้งสองกลไก ซึ่งไม่กระทบความถูกต้อง เพราะทั้งคู่เรียกฟังก์ชันตัดสินตัวเดียวกัน แต่เวลาตัดสินของ SQS ใช้เทียบไม่ได้
- ข้อสรุปเชิงระบบ: ห้ามรันทั้งสองโหมดบนฐานข้อมูลเดียวกันพร้อมกันในการใช้งานจริง

## ไฟล์หลักฐาน

| ไฟล์ | เนื้อหา |
| --- | --- |
| [`sqs/k6-report.html`](sqs/k6-report.html), [`db/k6-report.html`](db/k6-report.html) | รายงาน k6 web dashboard เปิดใน browser ได้ มีกราฟ request rate, latency และ error ตามเวลา |
| [`sqs/k6-summary.json`](sqs/k6-summary.json), [`db/k6-summary.json`](db/k6-summary.json) | ตัวเลขดิบทุก metric จาก `--summary-export` |
| [`sqs/k6-console.txt`](sqs/k6-console.txt), [`db/k6-console.txt`](db/k6-console.txt) | ผลลัพธ์ terminal ของ k6 ทั้งหมด รวม HTTP status ที่ได้ |
| [`sqs/db-result.txt`](sqs/db-result.txt), [`db/db-result.txt`](db/db-result.txt) | ผล query จากฐานข้อมูลหลังรอบทดสอบ: สถานะทุกคำขอ เวลา และ booking ที่ได้โต๊ะ |
| [`sqs/db-result-final.txt`](sqs/db-result-final.txt) | สถานะสุดท้ายของรอบ SQS หลังคิวว่าง พร้อมจำนวนที่ worker ตัดสินเอง |
| [`sqs/run-info.txt`](sqs/run-info.txt), [`db/run-info.txt`](db/run-info.txt) | run id, commit, วันเวลา และพารามิเตอร์ที่ใช้ |

## ตรวจซ้ำเองได้

ผลใน `db-result.txt` ได้จาก query นี้ (เปลี่ยน `<run_id>` ตาม `run-info.txt`):

```sql
select status, coalesce(result_code, '-') as result_code, count(*)
from booking_requests
where idempotency_key like 'burst-<run_id>-%'
group by 1, 2 order by 1, 2;
```

## หลังเพิ่ม audit trail (15 พฤศจิกายน 2569)

ทดสอบ 5,000 คำขอ / 250 พร้อมกันอีกครั้ง: รับ 202 ครบ ยืนยัน 1 ปฏิเสธ 4,999 ตรวจ hash chain ผ่าน ดู [ผลและข้อจำกัดการเทียบ p95](audit/README.md).
