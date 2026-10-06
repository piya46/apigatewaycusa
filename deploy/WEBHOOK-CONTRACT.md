# Gateway → application: delivery contract v1

สัญญาของโครงการนี้รองรับ CUSA SSO เดิม และกำหนดรูปแบบสำหรับแอปใหม่ โดยแยกการยืนยัน LINE ออกจากการยืนยัน Gateway ชื่อ `line-raw-v1` และ `event-json-v1` เป็นเวอร์ชันภายในโครงการ ไม่ใช่มาตรฐานที่ LINE ประกาศ

เส้นทางจริง: `LINE → https://api.reunion.scicu-alumni.com/webhooks/line → Redis → Worker → SSO/Chatbot/แอปอื่น` ใช้ HTTPS ทุกช่วงและ Redis TCP TLS (`rediss://`) ห้ามนำ URL/token จาก payload มาใช้เป็นปลายทางหรือ credential

## 1. SSO: `line-raw-v1`

ปลายทางที่ตรึงใน configuration:

```text
POST https://sso.reunion.scicu-alumni.com/api/auth/line/webhook
Content-Type: application/json
Authorization: Bearer <SSO_WEBHOOK_GATEWAY_TOKEN>
X-Line-Signature: <original verified LINE signature>
X-Gateway-Delivery: line-raw-v1
Idempotency-Key: <SHA-256 hex of original body bytes>
```

Body คือ **raw bytes เดิมทั้ง request** รวม whitespace, Unicode, ลำดับ field และทุก event ห้ามตัด `events`, stringify ใหม่, เปลี่ยน timestamp หรือสร้าง LINE signature ใหม่จากข้อมูลที่แก้แล้ว Gateway ตรวจ LINE signature ตอนรับและตรวจซ้ำก่อนส่ง SSO โดยใช้ secret ของ channel เดียวกัน

หนึ่ง signed batch ที่มี MFA อย่างน้อยหนึ่งรายการที่ผ่านตัวกรองจะสร้างงาน SSO หนึ่งงาน แม้มี MFA หลาย event; event อื่นใน batch เดียวกันยังอยู่ใน raw body เพื่อให้ลายเซ็นตรวจได้ SSO ต้องตรวจและประมวลผล MFA เป็นราย event พร้อมข้าม event อื่น/ผิดรูปแบบอย่างปลอดภัย ซึ่งตรงกับ `server/src/services/lineWebhook.ts` ใน CUSA ปัจจุบัน

Gateway จะไม่ส่งข้อมูล MFA หรือ raw batch นี้ไป Chatbot แม้มีกฎ catch-all postback ในหน้าจัดการ ถ้าทั้งชุดไม่มี MFA ที่ผ่าน จะทิ้งงาน SSO พร้อม log เฉพาะรหัส `invalid_mfa` ส่วน event ปกติยังส่งตามกฎของตน

SSO ต้องตรวจ `Authorization` แบบเปรียบเทียบเวลาคงที่เมื่อเปิด gateway token, ตรวจ LINE signature จาก raw body **ก่อน JSON parse**, ตรวจ `destination` และตรวจ challenge/เจ้าของบัญชี/อายุ/สถานะใช้แล้วในฐานข้อมูลเอง `X-Gateway-Delivery` และ `Idempotency-Key` เป็น metadata ไม่ใช่หลักฐานยืนยันตัวตน

### รูปแบบ MFA

- `event.type === "postback"` และ URLSearchParams มี key `cusa_mfa` (รองรับ key ที่ URL-encode และการสลับลำดับ)
- `postback.data` ยาวไม่เกิน 300 ตัว และมีสอง key เท่านั้น: `cusa_mfa=<UUID>&choice=<opaque base64url 43 ตัว>` อย่างละหนึ่งค่า ปฏิเสธ key ซ้ำรวม encoded duplicates
- `source.type === "user"`, `source.userId` เป็น `U` + hex ตัวเล็ก 32 ตัว
- timestamp เป็น integer มิลลิวินาที ต่างจากเวลาตรวจไม่เกิน 180,000 ms; mode ถ้ามีต้องเป็น `active`
- เก็บ `replyToken` ตามต้นฉบับ SSO ตรวจความถูกต้องก่อนใช้ ไม่ log ค่านี้

`choice` ไม่ใช่เลขปุ่มหรือคำว่า approve/deny ข้อความที่ผู้ใช้พิมพ์เองไม่ถือเป็น MFA และ `action=mfa` ไม่ใช่สัญญา CUSA ปัจจุบัน SSO ตอบ 200 เป็นเพียงรับ webhook สำเร็จ การออก session ยังอยู่ใน browser flow ของ SSO

### ค่าที่ต้องตรงกันสองฝั่ง

| Gateway `.env` | SSO `.env` | ความหมาย |
| --- | --- | --- |
| `LINE_CHANNEL_SECRET` | `LINE_MESSAGING_CHANNEL_SECRET` | Channel secret เดียวกันของ Messaging API channel |
| `LINE_WEBHOOK_DESTINATION` | `LINE_WEBHOOK_DESTINATION` | bot userId ของ OA เดียวกัน ไม่ใช่ Channel ID หรือ `@basicId` |
| `SSO_WEBHOOK_GATEWAY_TOKEN` | `LINE_WEBHOOK_GATEWAY_TOKEN` | Secret เฉพาะ Gateway → SSO แบบ base64url 43 ตัว |

ดู bot userId จาก [LINE Get bot info](https://developers.line.biz/en/reference/messaging-api/#get-bot-info) โดยใช้ Channel access token ฝั่งที่มีสิทธิ์ ไม่ต้องนำ access token มาใส่ Gateway

สร้าง token ใหม่ใน terminal ส่วนตัวด้วย `node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))'` เก็บเฉพาะ environment ฝั่ง server ทั้งสอง ห้ามใช้ซ้ำกับ LINE secret, SSO API key หรือ session secret และห้ามวางในหน้าจัดการ/Redis routing/แชต

เพื่อเปิด token โดยไม่ตัดระบบเดิม: ตั้ง destination ให้ตรงทั้งสองระบบก่อน จากนั้นตั้ง `SSO_WEBHOOK_GATEWAY_TOKEN` และ restart Gateway ให้เริ่มแนบ token ใหม่นี้ แล้วค่อยเปิด `LINE_WEBHOOK_GATEWAY_TOKEN` และ restart SSO เมื่อพร้อมตรวจทั้งสองชั้น หาก SSO เปิด token ไปแล้ว ต้องตั้งค่าที่ Gateway ให้ตรงก่อนส่ง traffic

ถ้ายังไม่ตั้ง dedicated token Gateway จะส่ง `INTERNAL_API_TOKEN` ตามสัญญาเดิม แต่ SSO รุ่นเดิมยังใช้ **LINE signature** เป็นการยืนยันหลัก SSO รุ่นที่เปิด `LINE_WEBHOOK_GATEWAY_TOKEN` ต้องใช้ค่า dedicated ที่ตรงกัน; API key สำหรับ login ไม่ใช้แทนได้ ไม่ปิด signature verification เพื่อแก้ 401

## 2. Chatbot และแอปใหม่: `event-json-v1`

เพิ่มแอป HTTPS ที่เชื่อถือได้และกฎใน `/admin/routes` โดยมี role `admin` ของบริการนี้ แอปทั่วไปได้รับ credential `INTERNAL_API_TOKEN` ร่วมกันตามสัญญาเดิม จึงควรเพิ่มเฉพาะบริการในขอบเขตความเชื่อถือเดียวกัน ห้ามใส่ URL ของบุคคลภายนอกหรือ URL ที่บรรจุ secrets

```text
POST <configured HTTPS endpoint>
Content-Type: application/json
Authorization: Bearer <INTERNAL_API_TOKEN>
X-Gateway-Delivery: event-json-v1
X-Webhook-Event-Id: <webhookEventId>
Idempotency-Key: <webhookEventId>
```

Body เป็น `{ "destination": "U…", "events": [<หนึ่ง event เดิม>] }` เก็บ field ภายใน event รวม source/replyToken ตามที่ LINE ส่ง ไม่เพิ่ม PII จากแหล่งอื่น และ **ไม่มี `X-Line-Signature`** เพราะมีการแยก envelope แล้ว

Receiver ต้องตรวจ Bearer token แบบเวลาคงที่, จำกัด request body, ตรวจ schema, ให้ event ID ใน headers ตรงกับ body และทำ idempotency ที่ฐานข้อมูลของตนก่อนเกิดผลข้างเคียง อย่าเชื่อ header `X-Gateway-Delivery` เพียงอย่างเดียว ไม่ใช่ endpoint สำหรับรับ LINE ตรง

## 3. Queue, duplicates, errors และ verification

- Gateway ตอบ LINE 200 หลัง Redis บันทึกสำเร็จ โดยไม่รอปลายทาง; คิวเต็ม/Redis ล้มเหลวตอบ 503 และต้องเปิด LINE redelivery
- Worker ใช้ lease และ `SET NX EX 3600` ก่อนส่ง โดย reserve ID ของ MFA ทั้ง batch แบบ atomic; งานแอปทั่วไปใช้ ID ของ event เดียว
- กฎทั่วไปและ fallback เลือก Reject ได้: Gateway ยังตอบ 200 หลังเข้าคิว แล้ว worker reserve ID และ ack โดยไม่ส่ง HTTP/ไม่เข้า DLQ (`event_dropped`, reason `policy_reject`) ไม่กระทบการแยก MFA ที่ป้องกันไว้และไม่แก้ raw signed batch ที่ SSO ได้รับ ไม่สามารถนำตัวอย่างในหน้าเหตุการณ์ล่าสุดมาส่งซ้ำได้
- เมื่อ ID ทุกตัวซ้ำจะทิ้งงาน หาก raw MFA batch มีทั้ง ID ซ้ำและใหม่ จะเข้า DLQ ด้วย `partial_duplicate` โดยไม่ reserve ID ใหม่และไม่ส่ง batch นั้น เนื่องจากการตัดรายการซ้ำจะทำให้ LINE signature เสีย ให้ตรวจเหตุและขอ MFA ใหม่ภายใน flow ของ SSO
- HTTP 2xx = delivered; redirect/4xx/5xx/timeout/network error = DLQ ไม่มี auto retry ปลายทาง ค่า timeout เริ่มต้น 4 วินาที ไม่มี cookie/Authorization/forwarded headers จากผู้ใช้ใน request ที่ส่งต่อ
- ความล้มเหลวแบบ timeout อาจเกิดหลังปลายทางทำงานแล้ว จึงไม่รับประกัน exactly-once: SSO ต้องบังคับ one-time challenge และแอปทั่วไปต้องทำ idempotency เองด้วย
- DLQ replay ปลด marker เฉพาะ ID ที่เป็นของงานนั้น หากมีเจ้าของใหม่จะไม่แตะงานหรือ marker MFA ที่เกิน 3 นาทีจะไม่ทำต่อแม้ replay; งานเก่าที่ไม่มี raw signature เก็บเป็น `missing_original` ไม่เซ็นทดแทน
- LINE verification `events: []` เข้าคิว raw SSO เช่นกัน ไม่มี MFA/message จริง และไม่ใช้ event idempotency marker การได้ 200 จาก Gateway ยังไม่รับประกันว่า SSO ตอบสำเร็จ ให้ตรวจ worker log `event_forwarded` target `sso` และ DLQ เพิ่ม
- Logs มีเฉพาะรหัสและ metadata ที่อนุญาต ไม่มี body, LINE ID, choice, signature หรือ token; queue/DLQ มีข้อมูลส่วนตัว จึงต้องจำกัดสิทธิ์ Redis และกำหนดระยะเก็บข้อมูลตามนโยบายของโครงการ
- หน้าเหตุการณ์ล่าสุดใช้ข้อมูลสรุปแยกจาก payload สูงสุด 200 รายการ / 24 ชั่วโมง ไม่มีข้อความ/source/replyToken/MFA parameter เก็บเฉพาะคำสั่งที่อนุญาตและ HMAC ภายในสำหรับเทียบเงื่อนไข ดูรายละเอียดใน README; ผล route เป็นการประเมินจาก configuration ปัจจุบัน ไม่ใช่ delivery receipt

โค้ดหลัก: `src/routes/webhooks.js`, `src/queue.js`, `src/worker.js`, `src/forward.js`; ตัวตรวจ MFA ร่วมกับ simulator: `public/admin/assets/line-contract.js` ขั้นตอน migration/rollback: [PLESK.md](PLESK.md#อัปเกรดเป็นสัญญา-webhook-v1-ที่รองรับ-sso-เดิม)

หลักการ raw-body HMAC อ้างอิง [LINE: Verify webhook signature](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)
