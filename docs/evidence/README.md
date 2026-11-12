# หลักฐานการทดสอบโหลด k6: ยิงคำขอจอง 5,000 รายการพร้อมกัน

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
