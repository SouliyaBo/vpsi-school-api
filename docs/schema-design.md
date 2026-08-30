# MongoDB Collection Design

> เอกสารนี้อธิบายการแปลง schema เชิงสัมพันธ์ (PostgreSQL, UUID + FK) มาเป็น document model
> บน MongoDB พร้อมเหตุผลของการตัดสินใจ **embed vs reference** และ index ที่จำเป็น

**Decisions ที่ยืนยันแล้ว:** NestJS · single-tenant (หนึ่ง deployment ต่อหนึ่งโรงเรียน) ·
backend API อย่างเดียว · MinIO (S3-compatible) สำหรับไฟล์

---

## 1. หลักการตัดสินใจ (Decision rubric)

การเลือก embed หรือ reference ในเอกสารนี้ใช้เกณฑ์ 4 ข้อ เรียงตามลำดับความสำคัญ:

| # | เกณฑ์ | ผลลัพธ์ |
|---|---|---|
| 1 | **Unbounded growth?** array ที่โตได้ไม่จำกัดตามเวลา | → **reference** เสมอ (เอกสาร Mongo จำกัด 16 MB) |
| 2 | **ถูกอ้างอิงจากหลาย parent?** | → **reference** (เลี่ยง update หลายที่) |
| 3 | **อ่านคู่กับ parent เกือบทุกครั้ง + เปลี่ยนน้อย?** | → **embed** |
| 4 | **ต้อง query ข้ามโดยไม่ผ่าน parent?** | → **reference** (หรือ embed + duplicate key) |

**หลักเพิ่มเติมที่ใช้ทั้งระบบ**

- **`_id` เป็น `ObjectId`** ทุก collection — ประหยัดกว่า UUID string 2 เท่า (12 B vs 36 B),
  index เล็กกว่า และมี timestamp ในตัว ส่วน "รหัส" ที่มนุษย์ใช้ (`studentCode`, `teacherCode`)
  เก็บเป็น field แยกพร้อม unique index
- **Denormalization แบบมีขอบเขต** — คัดลอกเฉพาะ field ที่ *ไม่เปลี่ยน หรือเปลี่ยนน้อยมาก*
  (เช่น `studentCode`, ชื่อ) ไปเก็บคู่กับ reference เพื่อลด `$lookup` ในหน้า list
  ทุกจุดที่ทำแบบนี้จะมี comment `// denormalized` และมีจุด sync ที่ระบุชัดในเอกสารนี้
- **Soft delete** ผ่าน `deletedAt` (nullable) กับ master data ที่ถูกอ้างอิง — กันข้อมูลย้อนหลังพัง
- **Enum** → TypeScript union type + Mongoose `enum` validator ประกาศที่เดียวใน
  `src/common/constants/enums.ts`
- **`jsonb`** เดิม → `Mixed` เฉพาะที่โครงสร้างอิสระจริง (`settings.value`,
  `reportTemplates.layout`, `auditLogs.oldValue/newValue`) นอกนั้นใช้ sub-schema ที่กำหนดชัด
  (`roles.permissions` เป็น sub-schema เพราะต้อง validate และ query ได้)

---

## 2. ตารางสรุปการตัดสินใจ

| Collection | ความสัมพันธ์เดิม | ตัดสินใจ | เหตุผล |
|---|---|---|---|
| `users` | FK → teacher/student/guardian | **reference แบบ polymorphic** (`personType` + `personId`) | user หนึ่งผูกกับบุคคลได้แบบเดียว; แยก auth ออกจาก profile ทำให้ rotate password/token ไม่แตะ document บุคคล |
| `roles` | 1-M กับ users, `permissions` jsonb | collection แยก + **embed permission matrix** | role มีไม่กี่สิบ record, permissions อ่านคู่กันเสมอตอน authorize, และ cache ใน Redis ได้ทั้งก้อน |
| `teachers` | ตารางหลัก | collection แยก | ถูกอ้างจาก classrooms / teachingAssignments / lessonPlans |
| `students` | ตารางหลัก | collection แยก + **embed `guardians[]` แบบย่อ** | หน้า profile นักเรียนต้องโชว์ผู้ปกครองเกือบทุกครั้ง และมี 1–4 คน (bounded) |
| `guardians` | ตารางหลัก | collection แยก (full record) | ผู้ปกครองหนึ่งคนมีลูกหลายคน → ถ้า embed อย่างเดียวจะซ้ำและ update ยาก |
| `studentGuardians` | join table + metadata | **embed ใน `students.guardians[]`** | ความสัมพันธ์อ่านจากฝั่งนักเรียนเป็นหลัก, bounded, metadata (`relationship`, `isPrimary`, `isEmergencyContact`) ผูกกับคู่ความสัมพันธ์ |
| `locations` | self-reference `parentId` | collection แยก + **`ancestors[]` (materialized path)** | Mongo ไม่มี recursive CTE — เก็บ ancestors ทำให้ "ทุกหมู่บ้านในแขวง X" เป็น query เดียว |
| `schoolYears`, `semesters`, `gradeLevels` | master data | collection แยก | ถูกอ้างจากแทบทุกที่, จำนวนน้อย → cache ได้ |
| `classrooms` | FK ครูประจำชั้น | collection แยก | ถูกอ้างจาก enrollments/teachingAssignments |
| `subjectGroups` | สายวิชา (ໜ່ວຍ/ສາຍ) | collection แยก | เป็น "แกน" ที่ `subjects` และ `teachers` อ้างถึง และเป็นเส้นทางส่งงานให้หัวหน้าสาย — ดู §3.9 |
| `subjects` | FK grade level + subject group | collection แยก | ถูกอ้างจาก scores/teachingAssignments |
| `teachingAssignments` | join + schedule | collection แยก + **embed `schedule[]`** | คาบสอนต่อการมอบหมายมี bounded (~1–6 คาบ/สัปดาห์) และต้องอ่านคู่กันเพื่อตรวจ conflict |
| `enrollments` | join table | collection แยก | โตตามจำนวน นักเรียน × ปี — unbounded ในระยะยาว |
| `scoreComponents` | 1-M ต่อวิชา/เทอม | collection แยก + **`weight` sum ≤ 100 validate ที่ service** | ครูแก้ weight ได้ระหว่างเทอม, ถูกอ้างจากทุก score record |
| `scores` | 1-M ขนาดใหญ่ | collection แยก | นักเรียน × วิชา × component × เทอม = โตเร็วมาก |
| `conductScores` | 1-M รายเดือน/ภาค/ปี | collection แยก | โตตามเวลา |
| `attendances` | 1-M รายวัน | collection แยก | โตเร็วที่สุดในระบบ (นักเรียน × วัน × คาบ) |
| `termResults` | 1-M ผลสรุป | collection แยก + **embed `subjects[]` breakdown** | ผลรายวิชาของเทอมนั้น bounded (~8–15 วิชา) และอ่านคู่กันตอนออก report card |
| `lessonPlans` | 1-M + activities + reviews | collection แยก + **embed `activities[]` และ `reviews[]`** | lifecycle ผูกกับ plan เดียว, bounded, ไม่ถูกอ้างจากที่อื่น |
| `announcements` | + `announcementTargets` | collection แยก + **embed `targets[]`** | target มีไม่กี่รายการต่อประกาศ และใช้ตอน resolve ผู้รับเท่านั้น |
| `notifications` | 1-M ต่อ user | collection แยก + **TTL index** | unbounded; ลบอัตโนมัติหลัง 90 วัน |
| `auditLogs` | append-only | collection แยก + **TTL index** | unbounded, write-heavy, ไม่ควรอยู่ใน document อื่น |
| `settings` | key-value | collection แยก, `value` เป็น `Mixed` | คนละ shape ต่อ key |

---

## 3. รายละเอียดการตัดสินใจที่ไม่ตรงไปตรงมา

### 3.1 `studentGuardians` → embed ใน `students`, full record ใน `guardians`

Schema เดิมเป็น join table สามทาง (student ↔ guardian + metadata) ในเอกสาร model
เราแยกเป็นสองส่วน:

```
guardians          (full record: ชื่อ, อาชีพ, เบอร์, ที่อยู่, บัตรประชาชน)
students.guardians[]  { guardianId, fullName*, phone*, relationship,
                        isPrimary, isEmergencyContact }   // * = denormalized
```

**ทำไมไม่ embed guardian ทั้งก้อน** — ผู้ปกครองหนึ่งคนมักมีลูกหลายคนในโรงเรียนเดียวกัน
ถ้า embed ทั้ง record การเปลี่ยนเบอร์โทรต้องไล่ update ทุกนักเรียน

**ทำไมไม่ reference อย่างเดียว** — หน้ารายชื่อนักเรียนและใบรายงานผลต้องโชว์
"ผู้ปกครองหลัก + เบอร์ติดต่อ" เสมอ การ `$lookup` ทุกแถวในหน้า list 50 รายการเป็นต้นทุนที่เลี่ยงได้

**จุด sync** — `GuardiansService.update()` เขียน `guardians` แล้ว `$set` field ที่ denormalize
ใน `students.guardians.$[el]` ภายใน transaction เดียวกัน (ดู
`src/modules/guardians/guardians.service.ts`) นี่คือ **จุดเดียว** ที่ sync field เหล่านี้

**Query จากฝั่งผู้ปกครอง** ("ผู้ปกครองคนนี้มีลูกกี่คน") ใช้
`students.find({ 'guardians.guardianId': id })` — มี index รองรับ

### 3.2 `locations` → ancestors array (materialized path)

Self-reference tree (province → district → village) ใน Mongo ทำได้หลายแบบ เราเลือก
**ancestors array** เพราะ query pattern จริงของระบบคือ "กรองนักเรียนตามแขวง/เมือง":

```jsonc
{
  "_id": "...village",
  "nameLo": "ບ້ານໂພນສະຫວັນ",
  "type": "village",
  "parentId": "...district",
  "ancestors": ["...province", "...district"],  // เรียงจากรากลงมา
  "path": ",province,district,",                // สำหรับ prefix regex
  "depth": 2
}
```

- "ทุกหมู่บ้านในแขวง X" → `{ ancestors: provinceId }` — index เดียว, ไม่ต้อง recursive
- `$graphLookup` ทำได้แต่ช้ากว่ามากและ index ช่วยไม่ได้เต็มที่
- Tree มี 3 ระดับคงที่และแทบไม่เปลี่ยน → cache ทั้ง tree ใน Redis (TTL 1 ชม.)
- ต้นทุน: ย้าย node ต้อง update ancestors ของลูกหลานทั้งหมด — ยอมรับได้เพราะแทบไม่เกิด

**`code` คือ identity ของ node** — ไม่ใช่ชื่อ ระบบยึดรหัสทางการ (แขวง `01`, เมือง
`0101`, บ้าน `0101001`) ตามรายการที่ทางการออกให้ เก็บไว้ที่
`src/database/locations/lao-address.data.ts` (18 แขวง, 149 เมือง และบ้านของ
นะคອນຫຼວງວຽງຈັນ 488 บ้าน — รายการทางการมีบ้านเฉพาะนครหลวง) นำเข้าด้วย

```bash
npm run import:locations -- --dry-run   # ดูก่อนว่าจะเปลี่ยนอะไร
npm run import:locations
```

รันซ้ำได้: upsert ตาม `code` และ **จับ row เดิมที่ชื่อตรงกันมาใช้ `_id` เดิม** เพื่อไม่ให้
`villageId` ของนักเรียน/ครู/ผู้ปกครองที่ชี้อยู่กลายเป็นขยะ แถวที่สะกดซ้ำจะถูกยุบเข้าตัวหลัก
พร้อมย้าย reference ส่วนชื่อที่รายการทางการไม่มีจะถูกเก็บไว้ (ไม่มี `code`) แล้วรายงานใน
`data/location-import-report.json` ให้ธุรการตัดสิน

ผลตามมา: **importer ทั้งสองตัวไม่สร้าง location อีกแล้ว** (`resolveOfficialVillage`) —
ที่อยู่ที่จับคู่ไม่ได้จะถูกรายงานและ **ไม่เขียนทับ `villageId` เดิม** เพราะ null ที่แปลว่า
"อ่านไม่ออก" ไม่ใช่ null ที่แปลว่า "ไม่มีที่อยู่"

### 3.3 `scores` → หนึ่ง document ต่อ (นักเรียน, component)

ทางเลือกที่พิจารณา: embed คะแนนทุก component ไว้ใน enrollment เดียว

**ไม่เลือก** เพราะ:
- ครูคนละคนสอนคนละวิชาแต่จะเขียน document เดียวกัน → write contention
- การ lock คะแนน (`isLocked`) เป็นรายวิชา/รายเทอม ไม่ใช่รายนักเรียน
- audit ของการแก้คะแนนหลัง lock ต้องอ้างถึง score record เจาะจง

โครงที่ใช้ — flat document พร้อม key ครบสำหรับ query โดยไม่ join:

```jsonc
{
  "studentId": "...", "subjectId": "...", "componentId": "...",
  "schoolYearId": "...", "semesterId": "...", "classroomId": "...",
  "score": 17.5, "maxScore": 20,
  "isLocked": true, "lockedAt": "...", "lockedBy": "...",
  "recordedBy": "...", "revisionCount": 0
}
```

`schoolYearId`/`semesterId`/`classroomId` เป็น denormalized จาก enrollment — ทำให้
aggregation คำนวณ term result ไม่ต้อง `$lookup` เลย และค่าเหล่านี้ **ไม่เปลี่ยน**
หลังบันทึก (ถ้านักเรียนย้ายห้อง คะแนนเทอมเดิมต้องอยู่กับห้องเดิม) → ปลอดภัยที่จะ denormalize

**Unique index** `{ studentId, componentId }` กันบันทึกซ้ำ และทำให้ upsert ปลอดภัย

### 3.4 `termResults` → embed `subjects[]`

ผลรายวิชาต่อเทอมมีขอบเขตชัด (~8–15 วิชา) และถูกอ่านพร้อมกันเสมอตอนออก report card:

```jsonc
{
  "studentId": "...", "semesterId": "...", "classroomId": "...",
  "subjects": [
    { "subjectId": "...", "subjectNameLo": "ຄະນິດສາດ",  // denormalized
      "totalScore": 82.5, "maxScore": 100, "percentage": 82.5,
      "grade": "B", "gradePoint": 3.0, "isPassed": true,
      "components": [{ "componentId": "...", "name": "ສອບເສັງກາງພາກ",
                       "score": 17.5, "maxScore": 20, "weight": 20,
                       "weightedScore": 17.5 }] }
  ],
  "average": 82.5, "grade": "B", "rank": 3, "totalStudents": 42,
  "conductGrade": "excellent",
  "computedAt": "...", "computationVersion": 2
}
```

`computationVersion` ทำให้ re-compute แล้วรู้ว่าใช้สูตรรุ่นไหน — สำคัญเพราะเกณฑ์เกรด
เปลี่ยนได้จาก `settings`

### 3.5 `teachingAssignments` → embed `schedule[]` + การตรวจ conflict

```jsonc
{
  "teacherId": "...", "subjectId": "...", "classroomId": "...",
  "semesterId": "...",
  "schedule": [
    { "dayOfWeek": 1, "startTime": "08:00", "endTime": "08:50", "room": "A101" }
  ]
}
```

เวลาเก็บเป็น `"HH:mm"` string — เทียบกันแบบ lexicographic ได้ตรงกับลำดับเวลา
และไม่มีปัญหา timezone (คาบเรียนเป็นเวลาท้องถิ่นเสมอ)

Conflict มี 3 แบบ ตรวจทั้งหมดใน `TeachingAssignmentsService.assertNoConflict()`:
1. **ครูซ้อน** — ครูคนเดียวกัน เทอมเดียวกัน คาบทับกัน
2. **ห้องเรียนซ้อน** — classroom เดียวกัน คาบทับกัน (นักเรียนอยู่ได้ที่เดียว)
3. **ห้องกายภาพซ้อน** — `room` เดียวกัน คาบทับกัน (ข้ามได้ถ้า `room` ว่าง)

เงื่อนไขทับ: `existing.startTime < new.endTime && new.startTime < existing.endTime`

### 3.6 `users` → polymorphic reference

```jsonc
{ "username": "...", "passwordHash": "...", "roleId": "...",
  "personType": "teacher" | "student" | "guardian" | "staff",
  "personId": "..." }
```

Discriminator ของ Mongoose ไม่เหมาะที่นี่เพราะ teacher/student/guardian มีอายุการใช้งาน
ต่างจาก account (นักเรียนมีตัวตนก่อนได้ account, บาง guardian ไม่เคยมี account)
การแยก `users` ออกมาทำให้ password/refresh token ไม่ปนกับข้อมูลบุคคล และ
`personType + personId` มี unique partial index กัน account ซ้ำต่อบุคคล

### 3.7 Refresh token rotation

เก็บ **hash** ของ refresh token (SHA-256) ใน `users.refreshTokens[]` พร้อม
`expiresAt`, `createdAt`, `userAgent`, `ip` — array bounded ที่ 5 device
(เกินแล้วตัดตัวเก่าสุดทิ้ง) การ rotate = ลบ hash เดิม + push ใหม่ ใน update เดียว
ถ้า refresh token ที่ส่งมาไม่อยู่ใน array → **revoke ทุก session ของ user นั้น**
(สัญญาณว่า token ถูกขโมยแล้วใช้ซ้ำ)

### 3.8 `enrollments` → unique เฉพาะ `status: 'active'`

Unique index บน `{ studentId, schoolYearId }` **ต้อง scope ที่ `status: 'active'`**
ไม่ใช่ทุกแถวที่ยังไม่ถูกลบ:

```jsonc
{ unique: true, partialFilterExpression: { status: 'active', deletedAt: null } }
```

เหตุผล — การย้ายห้องกลางปีทำให้มี enrollment **สองแถว** ของนักเรียนคนเดียวในปีเดียวกัน
โดยเจตนา: แถวต้นทาง `status: transferred` และแถวปลายทาง `status: active`
ถ้า unique ครอบทุกแถวที่ `deletedAt: null` การย้ายห้องจะถูก index ปฏิเสธ และทางแก้เดียว
คือลบประวัติห้องเดิม — ซึ่งทำลายข้อมูลที่ต้องเก็บไว้

**ลำดับการเขียนสำคัญ** — `EnrollmentsService.changeStatus()` ต้องอัปเดตแถวต้นทางให้พ้น
`active` **ก่อน** สร้างแถวปลายทาง มิฉะนั้นจะมีสองแถว `active` ชั่วขณะและชน unique index
ทั้งสอง operation อยู่ใน transaction เดียวกัน

การตรวจ "ลงทะเบียนซ้ำ" ใน service ก็ต้อง match index นี้ (`status: 'active'`)
ไม่เช่นนั้นนักเรียนที่ `dropped` แล้วกลับมาเรียนจะถูกปฏิเสธ

### 3.9 `subjectGroups` → collection แยก ไม่ใช่ string บน `subjects`

สายวิชาน่าจะเก็บเป็น string บน `subjects` ได้ (`subjects.group = 'science'`) แต่มี
สองอย่างที่ string ตอบไม่ได้

**หนึ่ง — `subjects` เป็นราย grade level** `MATH-M1` … `MATH-M7` เป็น 7 document
คนละอัน ถ้าจัดกลุ่มการติดตามแผนการสอนด้วย `subjectId` "สายคณิตศาสตร์" จะแตกเป็น
7 กลุ่ม ในขณะที่โรงเรียนมองเป็นสายเดียว — สายวิชาต้องเป็นสิ่งที่อยู่ *เหนือ* grade level

**สอง — สายวิชามีหัวหน้า** `teachers.isAcademicHead` บอกว่าใครเป็นหัวหน้า แต่ไม่บอกว่า
หัวหน้า *สายไหน* ก่อนมี collection นี้ การส่งแผนการสอนหนึ่งใบต้องแจ้งเตือนหัวหน้า
**ทุกคน** ในโรงเรียน เพราะไม่มีข้อมูลพอจะรู้ว่าใครรับผิดชอบ `headTeacherId` บน
`subjectGroups` คือสิ่งที่ทำให้ routing เป็นไปได้

ทั้ง `subjects.subjectGroupId` และ `teachers.subjectGroupId` เป็น **nullable** โดยเจตนา:
row เดิมมีอยู่ก่อน collection นี้ และ migration ที่เดาสายวิชาจากชื่อจะผิดสำหรับวิชาที่
โรงเรียนแบ่งต่างจากที่เดา — วิชาที่ยังไม่ได้จัดสายจะไปอยู่กลุ่ม "ยังไม่ได้จัดสาย"
ท้ายตารางติดตาม ซึ่งเป็นการเตือนที่มองเห็นได้ว่ายังต้องจัด

### 3.10 `lessonPlans` → `weekStartDate` snap เป็นวันจันทร์ + `dueDate` เป็น derived

ตารางติดตาม (`GET /lesson-plans/compliance`) ตอบคำถามที่ list endpoint ตอบไม่ได้:
"อาทิตย์ไหนที่ *ไม่มี* แผน" — คำตอบไม่ได้อยู่ใน collection เพราะ document ที่ไม่เคยถูกสร้าง
ไม่มีทางถูก query เจอ วิธีทำคือกลับด้าน: สร้างเซตที่ *ควรมี* จาก `teachingAssignments`
× สัปดาห์ของภาคเรียน แล้วเอาแผนที่มีจริงไปเทียบ ช่องที่ไม่มีคู่คือคำตอบ

การเทียบนั้นต้องเป็นการ match วันที่แบบตรงตัว จึงมีข้อบังคับสองข้อ

- **`weekStartDate` ถูก snap เป็นวันจันทร์ของสัปดาห์นั้น** ตอนเขียน (`startOfWeek`)
  ครูเลือกวันพุธก็ยังลงช่องเดิม ถ้าไม่ normalize ช่องนั้นจะดูเหมือนยังไม่มีแผน
- **`dueDate` มาจากนโยบายโรงเรียน** (`settings['lessonPlans.submissionPolicy']`)
  ไม่ใช่จาก request body เดิม DTO รับ `dueDate` จากครู ซึ่งทำให้ `isLate` เป็น `false`
  ตลอด — ครูที่กำหนดกำหนดส่งของตัวเองไม่มีทางส่งช้า และตัวเลขที่รายงานก็ไม่มีความหมาย
  (`isLate` ยังคงถูก freeze ตอน submit เหมือนเดิม การเปลี่ยนนโยบายภายหลังจึงไม่ย้อน
  ไปทำให้แผนที่ส่งตรงเวลากลายเป็นส่งช้า)

---

## 4. Index plan

### Unique / uniqueness constraints

| Collection | Index | หมายเหตุ |
|---|---|---|
| `users` | `{ username: 1 }` unique | |
| `users` | `{ email: 1 }` unique, partial `email != null` | email เป็น optional |
| `users` | `{ personType: 1, personId: 1 }` unique, partial `personId != null` | หนึ่ง account ต่อบุคคล |
| `roles` | `{ code: 1 }` unique | |
| `teachers` | `{ teacherCode: 1 }` unique | |
| `students` | `{ studentCode: 1 }` unique | |
| `guardians` | `{ nationalId: 1 }` unique partial | บาง record ไม่มีเลขบัตร |
| `schoolYears` | `{ code: 1 }` unique | เช่น `2025-2026` |
| `semesters` | `{ schoolYearId: 1, number: 1 }` unique | |
| `gradeLevels` | `{ code: 1 }` unique | |
| `classrooms` | `{ schoolYearId: 1, gradeLevelId: 1, name: 1 }` unique | |
| `subjectGroups` | `{ code: 1 }` unique | เช่น `science` |
| `subjects` | `{ code: 1 }` unique | |
| `enrollments` | `{ studentId: 1, schoolYearId: 1 }` unique, partial `status: 'active'` | ดู §3.8 — scope เฉพาะ `active` |
| `scoreComponents` | `{ subjectId: 1, semesterId: 1, name: 1 }` unique | |
| `scores` | `{ studentId: 1, componentId: 1 }` unique | กันคะแนนซ้ำ |
| `attendances` | `{ studentId: 1, date: 1, period: 1 }` unique | |
| `conductScores` | `{ studentId: 1, semesterId: 1, periodType: 1, periodValue: 1 }` unique | |
| `termResults` | `{ studentId: 1, semesterId: 1 }` unique | |
| `certificates` | `{ certificateNumber: 1 }` unique | |
| `lessonPlans` | `{ teacherId, subjectId, classroomId, semesterId, weekStartDate }` unique, partial `deletedAt: null` | หนึ่งแผนต่อคาบต่อสัปดาห์ — ถ้าซ้ำ ตารางติดตามจะมีสองคำตอบในช่องเดียว |
| `settings` | `{ key: 1 }` unique | |

### Query-pattern indexes

| Collection | Index | รองรับ query |
|---|---|---|
| `locations` | `{ ancestors: 1 }` | ทุก node ใต้แขวง/เมือง |
| `locations` | `{ parentId: 1, type: 1 }` | ลูกโดยตรง |
| `students` | `{ villageId: 1, status: 1 }` | กรองตามหมู่บ้าน |
| `students` | `{ 'guardians.guardianId': 1 }` | ลูกของผู้ปกครองคนนี้ |
| `students` | text index `{ firstNameLo, lastNameLo, studentCode }` | ค้นหาชื่อ (รองรับ UTF-8 ลาว) |
| `enrollments` | `{ classroomId: 1, status: 1 }` | รายชื่อนักเรียนในห้อง |
| `enrollments` | `{ schoolYearId: 1, status: 1 }` | สถิติรายปี |
| `teachingAssignments` | `{ teacherId: 1, semesterId: 1 }` | ตารางสอนของครู + conflict check |
| `teachingAssignments` | `{ classroomId: 1, semesterId: 1 }` | ตารางเรียนของห้อง |
| `scores` | `{ studentId: 1, semesterId: 1 }` | คะแนนของนักเรียนในเทอม |
| `scores` | `{ classroomId: 1, subjectId: 1, semesterId: 1 }` | กรอกคะแนนทั้งห้อง (หน้าหลักของครู) |
| `attendances` | `{ classroomId: 1, date: 1 }` | เช็คชื่อรายวัน |
| `attendances` | `{ studentId: 1, semesterId: 1, status: 1 }` | สถิติขาด/ลา/สาย |
| `termResults` | `{ classroomId: 1, semesterId: 1, average: -1 }` | จัดอันดับในห้อง |
| `notifications` | `{ userId: 1, isRead: 1, createdAt: -1 }` | กล่องแจ้งเตือน |
| `auditLogs` | `{ entityType: 1, entityId: 1, createdAt: -1 }` | ประวัติของ record |
| `auditLogs` | `{ userId: 1, createdAt: -1 }` | ประวัติของผู้ใช้ |
| `lessonPlans` | `{ teacherId: 1, semesterId: 1, status: 1 }` | แผนของครู |
| `lessonPlans` | `{ status: 1, dueDate: 1 }` | คิวตรวจ + แจ้งเตือนใกล้ครบกำหนด |
| `lessonPlans` | `{ semesterId: 1, weekStartDate: 1 }` | ตารางติดตาม — อ่านแผนทั้งภาคเรียนทีเดียว |
| `subjects` | `{ subjectGroupId: 1, isActive: 1 }` | วิชาในสายวิชานี้ (ใช้กรองตารางติดตาม) |
| `subjectGroups` | `{ sortOrder: 1, isActive: 1 }` | ลำดับการแสดงบนเมนูและตารางติดตาม |

### TTL indexes

| Collection | Index | อายุ |
|---|---|---|
| `notifications` | `{ createdAt: 1 }` expireAfterSeconds | 90 วัน |
| `auditLogs` | `{ createdAt: 1 }` expireAfterSeconds | 730 วัน (2 ปี) |

> `auditLogs` ที่ต้องเก็บถาวรตามระเบียบ ให้ export ออก cold storage ด้วย scheduled job
> ก่อนถึงกำหนด TTL

### Collation สำหรับภาษาลาว

ทุก index ที่ใช้เรียงชื่อภาษาลาวประกาศ `collation: { locale: 'lo', strength: 2 }`
ทำให้เรียงตามลำดับอักษรลาวจริง ไม่ใช่ code point และเทียบแบบ case-insensitive

---

## 5. Transaction boundaries

จุดที่เขียนหลาย collection พร้อมกันและต้อง atomic (ใช้ `withTransaction`):

| การทำงาน | Collections ที่แตะ |
|---|---|
| สร้างนักเรียน + ผูกผู้ปกครอง + สร้าง user account | `students`, `guardians`, `users`, `auditLogs` |
| แก้ข้อมูลผู้ปกครอง | `guardians` + `students.guardians[]` (sync denormalized) |
| ลงทะเบียนเรียน | `enrollments`, `classrooms.currentCount`, `auditLogs` |
| ย้ายห้อง/เลื่อนชั้น | `enrollments` (เก่า+ใหม่), `classrooms.currentCount` ×2 |
| Lock คะแนน | `scores` (หลาย doc), `auditLogs` |
| แก้คะแนนหลัง lock | `scores`, `auditLogs`, `notifications` |
| คำนวณ term result | `termResults` (bulk upsert + rank) |
| อนุมัติ/ตีกลับแผนการสอน | `lessonPlans`, `notifications` |

> **ข้อกำหนด deployment:** MongoDB ต้องรันเป็น replica set (แม้ single node)
> เพราะ multi-document transaction ใช้ไม่ได้บน standalone — `docker-compose.yml`
> ตั้ง `--replSet rs0` และ init ให้อัตโนมัติผ่าน healthcheck

---

## 6. Collection diagram

```mermaid
erDiagram
    ROLES     ||--o{ USERS : "has"
    USERS     }o--|| TEACHERS  : "personId (polymorphic)"
    USERS     }o--|| STUDENTS  : "personId (polymorphic)"
    USERS     }o--|| GUARDIANS : "personId (polymorphic)"

    LOCATIONS ||--o{ LOCATIONS : "parentId + ancestors[]"
    LOCATIONS ||--o{ STUDENTS  : "villageId"
    LOCATIONS ||--o{ TEACHERS  : "villageId"

    STUDENTS  ||--o{ GUARDIANS : "guardians[] embedded ref"

    SCHOOLYEARS ||--o{ SEMESTERS  : "has"
    SCHOOLYEARS ||--o{ CLASSROOMS : "has"
    GRADELEVELS ||--o{ CLASSROOMS : "has"
    GRADELEVELS ||--o{ SUBJECTS   : "has"

    SUBJECTGROUPS ||--o{ SUBJECTS : "subjectGroupId"
    SUBJECTGROUPS ||--o{ TEACHERS : "subjectGroupId"
    TEACHERS   ||--o| SUBJECTGROUPS : "headTeacherId"

    CLASSROOMS ||--o{ ENROLLMENTS : "has"
    STUDENTS   ||--o{ ENROLLMENTS : "has"

    TEACHERS   ||--o{ TEACHINGASSIGNMENTS : "teaches"
    SUBJECTS   ||--o{ TEACHINGASSIGNMENTS : "of"
    CLASSROOMS ||--o{ TEACHINGASSIGNMENTS : "in"

    SUBJECTS   ||--o{ SCORECOMPONENTS : "has"
    SCORECOMPONENTS ||--o{ SCORES     : "graded by"
    STUDENTS   ||--o{ SCORES          : "earns"
    STUDENTS   ||--o{ CONDUCTSCORES   : "earns"
    STUDENTS   ||--o{ ATTENDANCES     : "records"
    STUDENTS   ||--o{ TERMRESULTS     : "summarized in"

    TEACHERS   ||--o{ LESSONPLANS  : "submits"
    STUDENTS   ||--o{ EXAMREGISTRATIONS : "registers"
    EXAMREGISTRATIONS ||--o| EXAMRESULTS : "yields"
    STUDENTS   ||--o{ CERTIFICATES : "awarded"

    USERS      ||--o{ NOTIFICATIONS : "receives"
    USERS      ||--o{ AUDITLOGS     : "acts"
```

**Embedded sub-documents** (ไม่ใช่ collection แยก):

```
students.guardians[]              → { guardianId, fullName, phone, relationship,
                                      isPrimary, isEmergencyContact }
roles.permissions[]               → { resource, actions[] }
teachingAssignments.schedule[]    → { dayOfWeek, startTime, endTime, room }
termResults.subjects[]            → { subjectId, totalScore, grade, components[] }
lessonPlans.activities[]          → { topic, date, materials[], isCompleted }
lessonPlans.reviews[]             → { reviewerId, status, comment, reviewedAt }
announcements.targets[]           → { targetType, targetId }
users.refreshTokens[]             → { tokenHash, expiresAt, userAgent, ip }
locations.ancestors[]             → ObjectId[]
```

---

## 7. สิ่งที่ *ไม่* ได้ทำ และเหตุผล

- **ไม่ embed `enrollments` ใน `classrooms`** — ห้องหนึ่งมี 40–50 คน ดูเหมือน bounded
  แต่ enrollment มีสถานะเปลี่ยนบ่อย (transferred/dropped) และต้อง query
  "ประวัติการเรียนของนักเรียนคนนี้" ข้ามห้อง → reference ตรงกับ query pattern มากกว่า
- **ไม่ embed `scores` ใน `enrollments`** — เหตุผลใน §3.3
- **ไม่ใช้ `$graphLookup` กับ locations** — เหตุผลใน §3.2
- **ไม่ใส่ `schoolId` ทุก collection** — ยืนยันแล้วว่าเป็น single-tenant การเพิ่มทีหลัง
  ทำได้ผ่าน `BaseRepository` ที่ทุก service ใช้ร่วมกัน (จุดเดียวที่ต้องแก้)
- **ไม่เก็บ password history** — ไม่มีข้อกำหนดใน spec; ถ้าต้องการเพิ่มเป็น
  `users.passwordHistory[]` (bounded 5) ได้ทันที
