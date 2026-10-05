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

หากใส่ตัวแปรชื่อเดียวกันใน Custom Environment Variables ของ Plesk ค่าจาก Plesk จะถูกใช้แทน `.env` หลังเปลี่ยน environment ให้ Restart App ส่วนการแก้กฎผ่านหน้าแอดมินไม่ต้อง restart

ให้ HostAtom ยืนยันว่า `TRUST_PROXY=loopback` ตรงกับ proxy จริง และ proxy เขียนทับ `X-Forwarded-Proto` เปิดใบรับรอง TLS กับการ redirect HTTP ไป HTTPS ใน Plesk หากมี Nginx หน้า Apache ให้ตั้ง redirect ที่ชั้น TLS ไม่ใช้ `.htaccess` จนเกิด loop

## 4. ลงทะเบียน SSO และเปิดหน้าจัดการ

สัญญาที่ใช้คือ CUSA SSO OpenAPI **1.4.0** ที่ได้รับจากผู้ใช้: Authorization Code + PKCE S256, opaque access token อายุสูงสุด 300 วินาที ไม่มี JWT/JWKS หรือ refresh token สำหรับ flow นี้

1. สร้างแอป API Gateway ใน CUSA SSO และลงทะเบียน callback ให้ตรงกับ `SSO_REDIRECT_URI` ทุกตัวอักษร
2. อนุญาต requested scope `identity:read` และกำหนด API key scopes ตามตารางข้างต้น
3. กำหนด **service-specific role `admin`** ให้ผู้ดูแลในแอปนี้ โดย introspection ต้องคืน `roles: ["admin"]` หรือมี `admin` รวมอยู่ด้วย สิทธิ์ CUSA Admin ส่วนกลางไม่ใช้แทน role ของแอป
4. เปิด `https://api.reunion.scicu-alumni.com/admin/routes` แล้วกด “เข้าสู่ระบบด้วย CUSA SSO”
5. เมนู “แอปปลายทาง” ใช้เพิ่มชื่อแอปกับ URL; เมนู “กฎส่งต่อ” ใช้เพิ่ม/ปิด/เรียงกฎและเลือกแอปสำรอง
6. ใช้ “ทดลองเส้นทาง” ตรวจตัวอย่าง เช่น `postback` + `action=mfa` โดยไม่มีการส่ง event จริง จากนั้นกด “บันทึกการเปลี่ยนแปลง” เพื่อใช้กับงานถัดไป

Gateway ใช้ `/api/sso/authorize`, `/api/sso/token`, `/api/sso/introspect`, `/api/sso/revoke` ตามไฟล์ OpenAPI เก็บ access token ใน Redis พร้อม TTL; เบราว์เซอร์ถือเพียง session cookie แบบ HttpOnly/Secure/SameSite=Lax ตรวจ `active`, `aud`, `exp`, `roles` และ `identity:read` ทุก protected operation โดยไม่ cache identity ฝั่ง gateway

เมื่อครบอายุ token ให้เข้าสู่ระบบอีกครั้ง อาจมีหน้าขอ consent ตามนโยบาย SSO ระบบไม่มีการสร้าง refresh token หรือยืดอายุ session เอง หากมีฉบับแก้ไข ให้กด “เข้าสู่ระบบใหม่” เพื่อเปิดแท็บใหม่ แล้วกลับมายังหน้าเดิมและกด “ตรวจสอบการเข้าสู่ระบบ” เพื่อทำงานต่อโดยไม่เสียฉบับแก้ไข

**SSO login API กับปลายทาง LINE MFA เป็นคนละสัญญา:** OpenAPI ที่ได้รับไม่มี `/api/line/mfa` ค่าเริ่มต้นของแอป SSO ใน routing จึงอ้างอิง SRS เดิม ต้องยืนยัน URL และการรับ `Authorization: Bearer <INTERNAL_API_TOKEN>` กับทีม SSO ก่อนใช้ LINE MFA จริง ส่วน login ใช้ `X-API-Key: <SSO_API_KEY>` ตาม OpenAPI

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

- `config:check` ผ่าน; ทดสอบ Redis TLS จากโฮสต์ด้วย `--redis`
- เปิด `/admin/routes` แล้ว login ผ่าน SSO; ผู้ไม่มี role `admin` อ่าน/เขียนกฎไม่ได้
- เพิ่มกฎทดสอบแล้ว reload ต้องพบข้อมูลเดิม และ request ไม่มี CSRF token ต้องบันทึกไม่ได้
- LINE Verify ผ่าน และ event จริงถึงแอปที่ถูกต้อง; `action=mfa` เป็นกฎเริ่มต้นใน Redis
- `/ping` ที่ไม่มี secret ได้ `401`; Scheduled Task Run Now สำเร็จ
- `/.env`, `/app.js`, `/src/config.js`, `/logs/` ไม่เปิดเผยไฟล์ผ่านโดเมน
- กำหนด access log ของโฮสต์ไม่ให้เก็บ query string ของ `/auth/sso/callback` เพราะมี authorization code และไม่เปิด body/header logging ที่มี credentials

Worker ใช้งานได้หลาย process แต่ถ้าต้องการลำดับการส่งเสร็จแบบ FIFO และ log writer เดียว ให้ HostAtom ตั้ง Passenger เป็นหนึ่ง app process ดูการกู้คืน DLQ และข้อจำกัด exactly-once ใน README
