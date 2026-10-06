# ติดตั้งบน HostAtom Plesk (Linux / Passenger)

แพ็กเกจสำหรับอัปโหลด: `dist/reunion-gateway-plesk.zip` สร้างใหม่ได้ด้วย `npm run package:deploy` ภายในมี source, public assets, tests, lockfile และ configuration ตัวอย่าง ไม่มี `.env`, credentials, logs หรือ `node_modules`

## 1. เตรียมไฟล์และ Document Root

ใน Plesk File Manager สร้าง `reunion-gateway` ใต้ home ของ subscription อัปโหลด ZIP แล้ว extract เข้าโฟลเดอร์นี้โดยให้ `app.js` อยู่ที่ root ของโฟลเดอร์ ไม่ใช่โฟลเดอร์ซ้อนอีกชั้น

```text
reunion-gateway/                 ← Application Root
  app.js
  package.json
  package-lock.json
  .env                          ← อัปโหลด/สร้างแยก; permission 600
  src/
  scripts/
  logs/                         ← แอปสร้างเมื่อเริ่มทำงาน
  public/                       ← Document Root ของโดเมน
    admin/
```

ที่ Websites & Domains → `api.reunion.scicu-alumni.com` → Hosting Settings ตั้ง **Document Root = `reunion-gateway/public`** ให้ Plesk ใช้เฉพาะ public directory เป็น web root; อย่าตั้งเป็นโฟลเดอร์ที่มี `.env` และ `app.js`

การแยก Document Root เป็นโฟลเดอร์ลูกของ Application Root เป็นโครงสร้างที่ Plesk for Linux รองรับ ตาม [เอกสารติดตั้ง Node.js ของ Plesk](https://support.plesk.com/hc/en-us/articles/12377084794263-How-to-install-and-run-Node-js-application-in-Plesk)

## 2. ตั้ง Node.js

เปิด Node.js ในหน้าโดเมน แล้วตั้งค่าต่อไปนี้:

| ช่อง | ค่า |
| --- | --- |
| Node.js Version | 22 ขึ้นไป |
| Application Mode | production |
| Application Root | `reunion-gateway` |
| Document Root | `reunion-gateway/public` |
| Application Startup File | `app.js` |
| Application URL | `https://api.reunion.scicu-alumni.com` |

กด **NPM install** เพื่อติดตั้ง dependencies จาก package/lockfile แล้วใช้ **Run script → config:check** ตรวจ configuration ก่อน **Restart App** ไม่ต้องใช้ `npm start` เป็น background process เพิ่ม

หากมี Terminal สามารถใช้ `npm ci --omit=dev` ภายใต้ Node runtime ที่เลือกใน Plesk และ `npm run config:check -- --redis` เพื่อตรวจ Redis ด้วย `PING` โดยไม่ดึงหรือแก้ไขงานในคิว

Plesk อาจแสดงชื่อปุ่มต่างกันตามเวอร์ชัน รายละเอียดหน้าตั้งค่าอ้างอิง [Plesk Node.js Support](https://docs.plesk.com/en-US/obsidian/administrator-guide/website-management/nodejs-support.76652/)

## 3. เติม `.env`

ใช้ไฟล์ `.env` ที่เตรียมไว้ในเครื่อง หรือคัดลอก `.env.example` ไปเป็น `.env` บนโฮสต์ ตั้ง permission `600` และเติมข้อมูลต่อไปนี้:

| ตัวแปร | แหล่งข้อมูล |
| --- | --- |
| `LINE_CHANNEL_SECRET` | LINE Developers → Messaging API channel → Basic settings |
| `REDIS_URL` | Upstash TCP URL แบบ `rediss://` พร้อม password |
| `INTERNAL_API_TOKEN` | ค่าร่วมกันของ gateway และทุกแอปปลายทาง; อย่างน้อย 32 ตัวอักษร |
| `PING_SECRET` | Secret ของ keep-alive; อย่างน้อย 32 ตัวอักษร |
| `SSO_ORIGIN` | URL ของ CUSA SSO จริง; ตัวอย่างใช้ `https://sso.reunion.scicu-alumni.com` |
| `SSO_APPLICATION_ID` | UUID ของแอป API Gateway ที่ลงทะเบียนใน SSO |
| `SSO_API_KEY` | API key ของแอปเดียวกัน ซึ่งมี `identity:read`, `token:introspect`, `token:revoke` |
| `SSO_REDIRECT_URI` | `https://api.reunion.scicu-alumni.com/auth/sso/callback` |

`.env` ในเครื่องมี `INTERNAL_API_TOKEN` และ `PING_SECRET` ที่สุ่มไว้แล้ว ดู/คัดลอกค่าได้ใน IDE โดยไม่ต้องส่งเข้าห้องสนทนา ส่วนแพ็กเกจ ZIP ไม่มีค่าดังกล่าว

### ใช้ Upstash Redis

เปิด Upstash Console → ฐานข้อมูล Redis ที่สร้างไว้ → **Connect → TCP** แล้วคัดลอก connection string แบบ TLS ลง `REDIS_URL` ใน `.env` ทั้งบรรทัด ตัวอย่างโครงสร้าง:

```dotenv
REDIS_URL=rediss://default:YOUR_PASSWORD@YOUR_ENDPOINT:YOUR_PORT
```

แทนค่า password, endpoint และ port ตามฐานข้อมูลจริง หรือใช้ connection string ที่คัดลอกมาโดยตรง `rediss://:PASSWORD@HOST:PORT` ที่เว้น username ไว้ก็ใช้ได้ โครงการนี้ใช้ `ioredis` ผ่าน TCP/TLS จึงไม่ต้องเพิ่ม `UPSTASH_REDIS_REST_URL` หรือ `UPSTASH_REDIS_REST_TOKEN` ดู [วิธีคัดลอก connection string และเปิด TLS ของ Upstash](https://upstash.com/docs/redis/troubleshooting/econn_reset)

หลังเติม `LINE_CHANNEL_SECRET` และค่าที่จำเป็นครบแล้ว รัน `npm run config:check -- --redis` เพื่อตรวจ TLS และ authentication ด้วย `PING` โดยไม่แก้ข้อมูลในคิว ควรรันจาก Plesk ด้วย เพราะการเชื่อมต่อจากเครื่องพัฒนาได้ไม่ได้ยืนยันว่าโฮสต์อนุญาต TCP ขาออก

หากใส่ตัวแปรชื่อเดียวกันใน Custom Environment Variables ของ Plesk ค่าจาก Plesk จะถูกใช้แทน `.env` หลังเปลี่ยน environment ให้ Restart App ส่วนการแก้กฎผ่านหน้าแอดมินไม่ต้อง restart

ให้ HostAtom ยืนยันว่า `TRUST_PROXY=loopback` ตรงกับ proxy จริง และ proxy เขียนทับ `X-Forwarded-Proto` เปิดใบรับรอง TLS กับการ redirect HTTP ไป HTTPS ใน Plesk หากมี Nginx หน้า Apache ให้ตั้ง redirect ที่ชั้น TLS ไม่ใช้ `.htaccess` จนเกิด loop

### หากใบรับรอง TLS ไม่ตรงโดเมน Gateway

ถ้าตรวจแล้วพบ `ERR_TLS_CERT_ALTNAME_INVALID` หรือ `TLS certificate does not cover this hostname` ให้เปิดโดเมน **`api.reunion.scicu-alumni.com`** ใน Plesk → **SSL/TLS Certificates** แล้วออก/ติดตั้งใบรับรอง Let's Encrypt ที่ครอบคลุมชื่อนี้ จากนั้นตรวจ **Hosting Settings / Hosting → Certificate** ว่าเลือกใบรับรองนั้นให้โดเมน Gateway แล้ว และเปิด redirect HTTP → HTTPS

กรณีไม่มีเมนูออกใบรับรอง ให้ HostAtom ติดตั้งและผูกใบรับรองให้ชื่อโดเมนนี้ ดู [ขั้นตอน Let's Encrypt ของ Plesk](https://support.plesk.com/hc/en-us/articles/43603461610519-How-to-install-Let-s-Encrypt-SSL-certificate-for-a-domain-in-Plesk) การมีใบรับรองที่โดเมน SSO ไม่ได้ยืนยันว่า Gateway ใช้ใบรับรองถูกต้อง หลังแก้แล้วรัน `deploy:check -- --url https://api.reunion.scicu-alumni.com --public` อีกครั้ง

## 4. ลงทะเบียน SSO และเปิดหน้าจัดการ

สัญญาที่ใช้คือ CUSA SSO OpenAPI **1.4.0** ที่ได้รับจากผู้ใช้: Authorization Code + PKCE S256, opaque access token อายุสูงสุด 300 วินาที ไม่มี JWT/JWKS หรือ refresh token สำหรับ flow นี้

1. สร้างแอป API Gateway ใน CUSA SSO และลงทะเบียน callback ให้ตรงกับ `SSO_REDIRECT_URI` ทุกตัวอักษร
2. อนุญาต requested scope `identity:read` และกำหนด API key scopes ตามตารางข้างต้น
3. กำหนด **service-specific role `admin`** ให้ผู้ดูแลในแอปนี้ โดย introspection ต้องคืน `roles: ["admin"]` หรือมี `admin` รวมอยู่ด้วย สิทธิ์ CUSA Admin ส่วนกลางไม่ใช้แทน role ของแอป
4. เปิด `https://api.reunion.scicu-alumni.com/admin/routes` แล้วกด “เข้าสู่ระบบด้วย CUSA SSO”
5. เมนู “กฎส่งต่อ” แสดง MFA → SSO และปลายทางเริ่มต้นให้อยู่แล้ว หากต้องการแยกไปแอปอื่น เลือกแม่แบบข้อความ / กดปุ่ม / เพิ่มเพื่อน ฟอร์มเลือกเหตุการณ์และแอปเป็นภาษาไทย เพิ่มแอปใหม่พร้อมกฎได้ กรณีปุ่ม LINE วางตัวอย่าง `action=register` เพื่อช่วยเติมเงื่อนไข
6. ใช้ “ทดลองเส้นทาง” กดตัวอย่าง LINE MFA (`cusa_mfa` + `choice`) โดยไม่มีการส่ง event จริง จากนั้นกด “บันทึกการเปลี่ยนแปลง” เพื่อใช้กับงานถัดไป

Gateway ใช้ `/api/sso/authorize`, `/api/sso/token`, `/api/sso/introspect`, `/api/sso/revoke` ตามไฟล์ OpenAPI เก็บ access token ใน Redis พร้อม TTL; เบราว์เซอร์ถือเพียง session cookie แบบ HttpOnly/Secure/SameSite=Lax ตรวจ `active`, `aud`, `exp`, `roles` และ `identity:read` ทุก protected operation โดยไม่ cache identity ฝั่ง gateway

เมื่อครบอายุ token ให้เข้าสู่ระบบอีกครั้ง อาจมีหน้าขอ consent ตามนโยบาย SSO ระบบไม่มีการสร้าง refresh token หรือยืดอายุ session เอง หากมีฉบับแก้ไข ให้กด “เข้าสู่ระบบใหม่” เพื่อเปิดแท็บใหม่ แล้วกลับมายังหน้าเดิมและกด “ตรวจสอบการเข้าสู่ระบบ” เพื่อทำงานต่อโดยไม่เสียฉบับแก้ไข

**SSO login API และ LINE MFA ใช้คนละ credential:** login ใช้ `SSO_API_KEY`; LINE MFA ส่งไป `/api/auth/line/webhook` ด้วย raw LINE body + signature เดิม และ token เฉพาะ ดู [สัญญาการส่งต่อและตั้งค่าคู่กับ SSO](WEBHOOK-CONTRACT.md)

## 5. LINE และ Scheduled Tasks

ใน LINE Developers ตั้ง webhook URL เป็น `https://api.reunion.scicu-alumni.com/webhooks/line` เปิด Use webhook และ Webhook redelivery จากนั้นกด Verify

คัดลอก `deploy/keepalive.curl.example` ไปยังไฟล์ private เช่น `/var/www/vhosts/<subscription>/private/reunion-keepalive.curl` ใส่ `PING_SECRET` จริงแล้วตั้ง permission `600`

ใน **Scheduled Tasks** ของ subscription เลือก **Run a command** ตั้งทุก 5 นาที (`*/5 * * * *`) และใช้คำสั่ง:

```sh
/usr/bin/curl --config /var/www/vhosts/<subscription>/private/reunion-keepalive.curl
```

หาก Scheduled Task อยู่ใน chroot ให้ใช้ path ที่มองเห็นจาก environment ของ task นั้น โดยตรวจด้วย Run Now ห้ามวาง curl config ที่มี secret ใต้ `public` และไม่ใส่ secret ลง query string ของ task

Keep-alive เป็น liveness เท่านั้น ไม่รับประกันว่าแพ็กเกจ shared hosting จะไม่ suspend process ให้ตรวจ idle timeout, outbound Redis TLS และข้อจำกัด background timers กับ HostAtom

## 6. ตรวจหลังติดตั้ง

หลัง Restart App ใช้คำสั่งจากเครื่องที่เข้าถึงโดเมนได้:

```sh
# ตรวจเส้นทางสาธารณะ โดยไม่อ่านหรือส่ง secret จาก .env
npm run deploy:check -- --url https://api.reunion.scicu-alumni.com --public

# ตรวจเพิ่มด้วย PING_SECRET และ LINE_CHANNEL_SECRET จาก .env/Environment
npm run deploy:check -- --url https://api.reunion.scicu-alumni.com
```

คำสั่งตรวจหน้าแอดมินและ assets, การบล็อกผู้ไม่เข้าสู่ระบบ, signature ของ LINE, การป้องกัน path ภายใน และ HTTPS โดยไม่ติดตาม redirect อัตโนมัติ จะส่ง secret เฉพาะ HTTPS หลังการตรวจสาธารณะผ่านแล้ว Payload ที่ลงนามใช้ `events: []` และ destination จริงจาก `LINE_WEBHOOK_DESTINATION` จึงสร้างเฉพาะงาน verification ส่งต่อ SSO ไม่มี MFA/ข้อความจริง หากไม่ตั้ง destination จะข้ามรายการนี้ ตัว checker ไม่อ่าน/แก้ routing แต่ worker ที่รับงานจะอ่านและอาจย้าย routing รุ่นเก่าตามขั้นตอนอัปเกรด และไม่แสดง response body หรือ secret ใช้ `HEAD` ตรวจ path ภายในเพื่อไม่ดาวน์โหลดเนื้อหาไฟล์หากตั้ง Document Root ผิด

Exit code `0` = ผ่านรายการที่เลือก, `1` = มีรายการตรวจไม่ผ่าน, `2` = arguments หรือค่า secret ที่จำเป็นไม่ครบ โหมด `--public` ไม่ได้ตรวจ secret, Redis หรือการเข้าสู่ระบบ SSO จริง ให้ตรวจรายการด้านล่างเพิ่มเติม

- `config:check` ผ่าน; ทดสอบ Redis TLS จากโฮสต์ด้วย `--redis`
- เปิด `/admin/routes` แล้ว login ผ่าน SSO; ผู้ไม่มี role `admin` อ่าน/เขียนกฎไม่ได้
- เพิ่มกฎทดสอบแล้ว reload ต้องพบข้อมูลเดิม และ request ไม่มี CSRF token ต้องบันทึกไม่ได้
- LINE Verify ผ่าน และ event จริงถึงแอปที่ถูกต้อง; `cusa_mfa` เป็นเส้นทางที่ป้องกันไว้ไป SSO ก่อนกฎทั่วไป ต้องตรวจผล worker/DLQ เพิ่มจาก HTTP 200
- `/ping` ที่ไม่มี secret ได้ `401`; Scheduled Task Run Now สำเร็จ
- `/.env`, `/app.js`, `/src/config.js`, `/logs/` ไม่เปิดเผยไฟล์ผ่านโดเมน
- กำหนด access log ของโฮสต์ไม่ให้เก็บ query string ของ `/auth/sso/callback` เพราะมี authorization code และไม่เปิด body/header logging ที่มี credentials

Worker ใช้งานได้หลาย process แต่ถ้าต้องการลำดับการส่งเสร็จแบบ FIFO และ log writer เดียว ให้ HostAtom ตั้ง Passenger เป็นหนึ่ง app process ดูการกู้คืน DLQ และข้อจำกัด exactly-once ใน README


## อัปเกรดเป็นสัญญา Webhook v1 ที่รองรับ SSO เดิม

แพ็กเกจรุ่นนี้เปลี่ยน routing schema จาก 1 เป็น 2 และเพิ่ม raw-envelope job version 2 จึงต้อง **หยุด process รุ่นเก่าทั้งหมดก่อนเริ่มรุ่นใหม่** ไม่ deploy สลับรุ่นใน worker pool เดียวกัน เก็บสำเนาไฟล์รุ่นเดิมและ `.env` ไว้ในพื้นที่ private

1. เตรียมโค้ดจาก `dist/reunion-gateway-plesk.zip` และอ่าน [WEBHOOK-CONTRACT.md](WEBHOOK-CONTRACT.md) ร่วมกับทีม SSO ไฟล์ zip ไม่มี `.env` จริง
2. ตั้ง `SSO_WEBHOOK_URL=https://sso.reunion.scicu-alumni.com/api/auth/line/webhook` ทั้งใน `.env`/Plesk Environment ที่มีการ override อยู่ อย่าคัดลอก `.env.example` ทับ secrets เดิม
3. รัน `npm run config:check -- --redis` และ `npm run routing:check` ด้วยโค้ดใหม่ที่ยังไม่เริ่ม app คำสั่งหลังอ่าน routing อย่างเดียว บอก `migration_ready` เมื่อย้ายได้ และไม่อ่านงานในคิว
4. Stop/Disable Node.js application และให้ HostAtom ยืนยันว่า Passenger รุ่นเก่าหยุดทั้งหมด ก่อนแทนที่ source และ Start/Enable ใหม่ ใช้ช่วง maintenance สั้น ๆ และเปิด LINE redelivery
5. การอ่าน routing ครั้งแรกจะสำรอง JSON เดิมที่ `webhook:config:routing:backup:v1` แล้วเปลี่ยน schema/revision แบบ atomic ลบเฉพาะกฎ `line-mfa / action=mfa` ที่เปิดใช้ตามค่าเริ่มต้นเดิม และแก้ URL SSO เก่าที่รู้จัก แอปและกฎทั่วไปที่เพิ่มเองคงอยู่ หากพบกฎ SSO ที่ปรับเอง/ปิดไว้หรือ SSO เป็น fallback จะไม่เดาแทนผู้ดูแล: `routing:check` แจ้งให้ตรวจและปรับแผนก่อน deploy
6. เปิดหน้า admin ใหม่หลัง deploy ตรวจ SSO URL และแผง “CUSA MFA · เส้นทางที่ป้องกันไว้”; รัน `deploy:check`, กด Verify ใน LINE แล้วตรวจ log รหัส `event_forwarded` target `sso` กับ DLQ การได้ HTTP 200 ยืนยันเพียงการเข้าคิว
7. งานเก่าแบบราย event ที่เป็น `cusa_mfa` แต่ไม่มี raw body/signature จะเข้า DLQ ด้วย `missing_original` ไม่สร้างลายเซ็นทดแทน ให้ผู้ใช้ขอ MFA ใหม่ ไม่ replay งาน MFA ที่หมดอายุ

หากต้อง rollback: หยุดรุ่นใหม่ก่อน ตรวจคิว/processing/DLQ และเก็บ raw jobs version 2 ไว้ในพื้นที่ private อย่าให้ worker รุ่นเก่าอ่านงานเหล่านี้ จากนั้นจึงวาง source รุ่นเดิมและคืน routing จาก backup หลังผู้ดูแลตรวจว่ามีการแก้กฎใหม่หลังอัปเกรดหรือไม่ ไม่มีการลบคิวหรือคืน backup อัตโนมัติ


## อัปเดตหน้าจัดการ 1.1 → 1.2

รุ่น 1.2 เพิ่มแม่แบบกฎ ฟอร์มสร้างกฎแบบมีขั้นตอน การอ่านตัวอย่างปุ่ม คำเตือนลำดับ และการแสดงเส้นทางพื้นฐาน ใช้ routing schema 2 เดิม ไม่ต้องเพิ่ม environment หรือสร้างกฎเริ่มต้นทับของเดิม ให้อัปโหลดไฟล์จากแพ็กเกจรวม `public/admin/assets/rule-builder.js` และ `rule-editor.js` แล้ว Restart App และเปิดหน้า admin ใหม่ `deploy:check` ตรวจว่าไฟล์ใหม่ครบด้วย หากยังใช้รุ่น 1.0 ให้ทำขั้นตอน migration ด้านบนก่อน
