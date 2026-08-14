# VPSI School Management API

ລະບົບບໍລິຫານຈັດການໂຮງຮຽນ — a school management backend built on **NestJS + MongoDB**,
covering people, academic structure, enrollment, assessment, attendance, and term
results, with full RBAC and an audit trail.

**Stack:** TypeScript (strict) · NestJS 10 · MongoDB 7 + Mongoose 8 · Redis (cache +
BullMQ) · MinIO / S3 · JWT + argon2id · Swagger · Jest + supertest · Docker

**Decisions confirmed with the requester:** NestJS · single-tenant (one deployment
per school) · backend API only · MinIO for object storage.

---

## 1. Status — what is built

All six phases are complete. Every collection in the specification has a schema,
indexes, a module and API surface.

| Phase | Scope                                                                                                 | Status      |
| ----- | ----------------------------------------------------------------------------------------------------- | ----------- |
| 0     | Project setup, Docker, MongoDB, config validation, JWT auth, RBAC guard, error handling, logging      | ✅ Complete |
| 1     | Locations, school years, semesters, grade levels, classrooms, subjects, teachers, students, guardians | ✅ Complete |
| 2     | Teaching assignments, enrollments, score components, scores, conduct scores, attendance, term results | ✅ Complete |
| 3     | Report templates, PDF generation, lesson plans + review workflow                                      | ✅ Complete |
| 4     | Exam registration, exam results, certificates                                                         | ✅ Complete |
| 5     | Announcements, notifications, calendar, documents, feedback                                           | ✅ Complete |
| 6     | Rate limiting, caching, audit logs, settings, load test, security review, CI/CD                       | ✅ Complete |

**Deliverables**

- [x] MongoDB collection design with embed/reference rationale and index plan — [`docs/schema-design.md`](docs/schema-design.md)
- [x] Mongoose schemas + TypeScript interfaces for all collections — [`src/database/schemas/`](src/database/schemas/)
- [x] REST API for every module in the brief, with Swagger
- [x] Auth + RBAC, working end to end
- [x] Background job for term-result computation (BullMQ)
- [x] Unit and integration tests for grading, authorization, enrollment, and the lock workflow
- [x] Background job for report generation (BullMQ + PDF)
- [x] Docker Compose dev environment
- [x] Load-test profile and a written security review
- [x] This README

---

## 2. Quick start

### With Docker (recommended)

```bash
cp .env.example .env
# Generate real secrets — the examples are refused in production:
#   openssl rand -hex 48

docker compose up -d
docker compose exec api npm run seed
```

- API — http://localhost:3000/api
- Swagger — http://localhost:3000/api/docs
- MinIO console — http://localhost:9001 (`minioadmin` / `minioadmin`)

### Without Docker

Requires Node 20+, and MongoDB **running as a replica set** (see §3).

```bash
npm install
cp .env.example .env      # point MONGODB_URI at your instance
npm run seed
npm run start:dev
```

### First login

The seed creates one administrator:

| Username | Password      | Note                           |
| -------- | ------------- | ------------------------------ |
| `admin`  | `ChangeMe123` | Must be changed at first login |

Set `SEED_ADMIN_PASSWORD` before seeding to choose your own. Either way the account
is created with `mustChangePassword`, so it can do nothing but change its own
password until you do:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"ChangeMe123"}' | jq -r .tokens.accessToken)

curl -X POST http://localhost:3000/api/auth/change-password \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"currentPassword":"ChangeMe123","newPassword":"YourNewPass1"}'
```

---

## 3. MongoDB must be a replica set

Several operations write more than one collection atomically — creating a student
with their guardians, enrolling a student while adjusting the classroom headcount,
locking a component's scores. Those use MongoDB multi-document transactions, and
**transactions are unavailable on a standalone `mongod`**.

`docker-compose.yml` handles this: mongo starts with `--replSet rs0` and the
healthcheck initiates the set on first boot. For a manual setup:

```bash
mongod --replSet rs0 --bind_ip_all
mongosh --eval "rs.initiate()"
```

The connection string then needs `?replicaSet=rs0&directConnection=true`.

The test suite uses `mongodb-memory-server`'s `MongoMemoryReplSet` for the same
reason — no external database is needed to run it.

---

## 4. Architecture

```
src/
  common/          # guards, decorators, filters, DTOs, i18n, shared base service
  config/          # environment schema, validated at bootstrap
  database/
    schemas/       # every Mongoose schema + TS type
    seeds/         # idempotent seeder + role permission matrix
    transaction.helper.ts
  modules/
    auth/  roles/  users/                            # Phase 0
    locations/  school-years/  semesters/            # Phase 1
    grade-levels/  subjects/  classrooms/
    teachers/  guardians/  students/
    teaching-assignments/  enrollments/              # Phase 2
    score-components/  scores/  conduct-scores/
    attendances/  term-results/
    reports/  lesson-plans/                          # Phase 3
    exams/  certificates/                            # Phase 4
    announcements/  notifications/                   # Phase 5
    calendar/  documents/  feedback/
    audit-logs/  settings/  storage/  health/        # cross-cutting
  main.ts
assets/fonts/      # Lao font for PDF generation (see its README)
test/              # integration tests against an in-memory replica set
test/load/         # k6 load profile
docs/              # schema design and security review
```

### Guard chain

Applied globally, in order:

1. **ThrottlerGuard** — rate limiting, so a flood is rejected before it reaches the database.
2. **JwtAuthGuard** — authenticates. Routes are protected **by default**; opting out
   requires `@Public()`, so a forgotten decorator fails closed.
3. **PermissionsGuard** — checks `@RequirePermissions()` against the role matrix.
   `manage` on a resource implies every action on it.

The authenticated user is re-read from the database on every request rather than
trusted from the token, so a suspension or role change takes effect immediately
instead of lingering until the access token expires.

### Authorization beyond the matrix

Two rules cannot be expressed as resource permissions and are enforced in the
services:

- **Score entry is scoped to the assignment.** Holding `scores:create` is not
  enough — you must be the teacher assigned to that subject in that classroom.
  `scores:manage` (admin, academic office) bypasses this, so grades can still be
  corrected for a teacher who has left.
- **Students and guardians see only their own records.** A `read` grant answers
  "may this role read scores at all", never "_whose_". `RecordScopeService`
  narrows every student-scoped list and single-record read to the caller's own
  records — a guardian additionally needs `canViewRecords` on the link, and term
  and exam results stay hidden until published. Without it, a student holding
  `term-results:read` would list the whole school.

### Error handling and i18n

Services throw `AppException` carrying a message _key_, never a rendered string.
`AllExceptionsFilter` resolves the key against the request locale (`?lang=`, then
`Accept-Language`, then the default) at the edge. Message keys are compile-time
checked, so a typo fails the build rather than shipping a raw key to a user. Every
message exists in Lao and English — see [`src/common/i18n/messages.ts`](src/common/i18n/messages.ts).

```jsonc
// POST /api/enrollments on a full classroom
{
  "statusCode": 409,
  "error": "CONFLICT",
  "message": "ຫ້ອງຮຽນເຕັມແລ້ວ",
  "messageKey": "classroom.capacityExceeded",
  "details": { "capacity": 45, "currentCount": 45 },
  "path": "/api/enrollments",
  "timestamp": "2025-09-15T02:14:33.120Z",
}
```

---

## 5. Data model highlights

Full rationale in [`docs/schema-design.md`](docs/schema-design.md). The decisions
that shape the code:

| Decision                                                                                                                  | Why                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `students.guardians[]` embeds a **short projection** of each guardian; full records live in `guardians`                   | Student lists and report cards always need a contact, but a guardian with three children must not be stored three times. `GuardiansService.update()` is the one place the copies are re-synced, inside the same transaction. |
| `locations` carries an `ancestors[]` array (materialized path)                                                            | "Every village in this province" becomes one indexed equality match instead of a `$graphLookup`. Cost: moving a node rewrites its subtree — acceptable for data that never moves.                                            |
| `scores` is one document per (student, component), with school year / semester / classroom / subject denormalized onto it | The term-result aggregation runs with **no** `$lookup`. Those keys are immutable after write, so a student who transfers keeps their old marks attached to the class where they were earned.                                 |
| `termResults.subjects[]` embeds the per-subject breakdown                                                                 | Bounded at ~8–15 subjects and always read together with the result.                                                                                                                                                          |
| Schedule times are `"HH:mm"` strings                                                                                      | Class periods are local wall-clock with no date component; zero-padded strings compare lexicographically in chronological order, which is exactly what the overlap check needs — and there is no timezone to get wrong.      |
| Only S3 **object keys** are stored, never URLs                                                                            | URLs are minted on read as short-lived signed URLs, so a leaked database row does not expose a student's photo, and changing bucket or endpoint needs no migration.                                                          |
| `notifications` and `auditLogs` have TTL indexes (90 days / 2 years)                                                      | Both grow without bound. Audit rows that must be retained longer should be exported to cold storage by a scheduled job before the TTL reaches them.                                                                          |

---

## 6. Grading

The formulas live in one pure, dependency-free module —
[`src/modules/term-results/grading.ts`](src/modules/term-results/grading.ts) — so they
are exhaustively unit-testable. Three points worth knowing:

**A subject's mark is `Σ (score / maxScore × weight)`.** Weights must total 100,
which is enforced when the term result is computed rather than on every component
write (a teacher builds components up one at a time; rejecting the first for
summing to 20 would make the feature unusable). `GET /api/score-components/weight-summary`
lets the UI warn beforehand.

**An ungraded component is excluded and the result is flagged provisional — not
counted as zero.** The partial mark is rescaled over the weight recorded so far, so
a student with 18/20 on the only marked component reads as 90%, not 18%. Treating an
unmarked exam as zero would show a strong student as failing mid-term. A recorded
**absence** is different: it is an outcome of zero, and it counts.

**Averages and GPA are credit-weighted.** A 4-credit subject moves the average twice
as far as a 2-credit one; an unweighted mean would let a minor elective offset a core
subject. Ranks use competition ranking — ties share a rank and the next one skips
(1, 2, 2, 4).

`COMPUTATION_VERSION` is stored on every result. Bump it whenever a formula changes,
so a historical record can always be traced to the rules that produced it.

### Score lock workflow

```
enter marks → POST /api/scores/lock  (scores + component both locked)
                     │
                     ├── amend: POST /api/scores/batch with overrideReason
                     │         → revisionCount++, audit row tagged
                     │           "POST-LOCK AMENDMENT: <reason>"
                     │
                     └── reopen: POST /api/scores/unlock
                               → requires scores:manage + a reason ≥ 10 chars
```

Locking covers the **component** as well as the existing scores, so marks cannot be
added afterwards for students who had none — otherwise "locked" would only apply to
whatever happened to exist at the time.

---

## 7. Background jobs

Term-result computation runs on BullMQ because it reads every score for a class,
applies the formulas, then makes a second ranking pass — too slow to hold a request
open.

```bash
POST /api/term-results/compute      # → 202 { jobId }
GET  /api/term-results/compute/:id  # → state, progress, result
POST /api/term-results/compute-sync # bypasses the queue; small classes and tests
```

The job id is derived from `classroomId:semesterId`, so re-requesting the same class
while a job is pending reuses it instead of computing twice concurrently. The whole
operation is idempotent, so a retried job is harmless.

In Docker a separate `worker` container runs the same image with `WORKER_MODE=true`,
which boots the module graph without binding the HTTP port.

---

## 7a. PDF generation

Report cards and certificates are rendered with PDFKit. Two things about Lao make
this less trivial than it looks, and both are handled in
[`src/modules/reports/pdf/`](src/modules/reports/pdf/):

**A Lao-capable font is mandatory.** PDFKit's built-ins are WinAnsi-only and have
no Lao glyphs. Worse, a font can have every Lao glyph and still be wrong: without
OpenType `GPOS` mark positioning, combining vowels get a full advance width and
`ຜົນ` renders as `ຜ ົ ນ` — a document that looks plausible and is not.
`font-resolver.ts` checks for this at startup and warns loudly. The Docker image
installs Noto Sans Lao; for local development see
[`assets/fonts/README.md`](assets/fonts/README.md).

**Lao and Latin need different fonts in the same line.** Noto Sans Lao contains
only Lao — 116 glyphs, no digits, no letters, not even a period — so a report card
rendered with it alone loses every number and code. The renderer segments each
string by script and pairs the Lao face with Helvetica, placing the runs at
explicit coordinates on a shared alphabetic baseline. PDFKit's `continued` option
was the obvious approach and does not work here: the two faces have different
ascents, so chained runs sit at different heights, and each chunk is aligned
independently, which tears a right-aligned mixed string across two lines.

Templates are data, not code: `reportTemplates.layout` holds an ordered list of
typed sections (`studentInfo`, `subjectsTable`, `summary`, `signatures`, …). The
layout is validated on write, so a bad template fails at the API rather than
inside every background job it later feeds. Unknown section types are skipped
with a warning, so a template written for a newer build still renders.

---

## 7b. Lesson plans, exams and certificates

**Lesson plan workflow** — `draft → submitted → approved | returned`, and
`returned → submitted` again. Lateness is decided at submission and then fixed, so
a later change to the deadline cannot make a late plan punctual. Returning
requires a comment; approving is terminal, after which the plan cannot be edited
or deleted. `POST /lesson-plans/run-due-reminders` notifies teachers of plans due
within 48 hours or overdue — intended for a daily scheduler.

**Exam eligibility** is a pure function
([`exams/eligibility.ts`](src/modules/exams/eligibility.ts)) checking enrollment,
grade level, attendance rate and failed subjects, and refusing to decide from a
_provisional_ term result. An authorized caller may override with a stated
reason; the override, the reason and the failing checks are all written to the
registration snapshot and the audit log. Exam totals and pass/fail are computed
from the per-subject marks, never taken from the request, and every subject must
pass.

**Certificates** get a gap-free `<year>/<TYPE>/<ordinal>` serial. The number is
committed _before_ the PDF is rendered: rendering is slow and can fail on an
environment problem, and holding a transaction across it risks burning a number
in a series expected to have no gaps. `POST /certificates/:id/regenerate` fixes a
missing file. Revocation flags the record rather than deleting it — a number that
has circulated must stay verifiable, and "revoked" is a different answer from
"never existed". `GET /certificates/verify/:number` is public and rate-limited,
returns only the holder's name and validity, and answers `isValid: false` for an
unknown number so a typo and a forgery look the same from outside.

---

## 7c. Announcements and notifications

Announcements are created as **drafts**; publishing is a separate call because it
fans out notifications that cannot be recalled, and republishing is refused so
nobody is notified twice. Targets (`all`, `role`, `grade_level`, `classroom`,
`teachers`, `guardians`) are expanded into a deduplicated recipient list, so
overlapping targets do not double-notify. The feed is filtered in the database by
what actually targets the caller, so a classroom notice does not appear
school-wide.

`NotificationsService` is global and used by the score, lesson-plan, exam,
certificate and feedback flows. Delivery failures are logged and swallowed — a
lost notification must not turn a successful score submission into a 500.

**Anonymous feedback is genuinely anonymous**: no user id and no IP, on the record
or in the audit row, and no response notification. Anonymity an administrator can
undo by reading the database is not anonymity.

---

## 8. Roles

Seeded by [`src/database/seeds/role-permissions.ts`](src/database/seeds/role-permissions.ts).
System roles cannot be deleted, and their permissions cannot be edited — removing
`admin`'s own grants would lock everyone out with no way back.

| Role            | Summary                                                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin`         | Everything.                                                                                                                                                                 |
| `academic_head` | Curriculum, assignments, grading oversight, lesson-plan approval. **No** access to accounts or roles. Holds `scores:manage`, so it can unlock and correct submitted grades. |
| `teacher`       | Enters scores, conduct and attendance for **their own** classes; submits lesson plans. Can lock grades but not reopen them.                                                 |
| `registrar`     | Students, guardians, enrollment, exam registration. **No** access to scores.                                                                                                |
| `student`       | Own records only; term results only once published.                                                                                                                         |
| `guardian`      | Records of linked students, subject to `canViewRecords` and publication.                                                                                                    |

---

## 9. Testing

```bash
npm test              # unit tests
npm run test:cov      # with coverage
npm run test:e2e      # integration tests (boots an in-memory replica set)
npm run lint
npm run build

k6 run test/load/k6-smoke.js   # sustained-load profile; needs k6 and a seeded API
```

Current counts: **124 unit tests**, **154 integration tests**, all passing.

**Unit tests** cover the logic worth proving in isolation:

- `grading.spec.ts` — band boundaries, weighted marks, the partial-result rescale, absence vs ungraded, credit weighting, competition ranking, division-by-zero guards
- `schedule-conflict.spec.ts` — teacher / classroom / room clashes, back-to-back periods, the `09:00` vs `10:00` string-comparison case
- `permissions.guard.spec.ts` — the matrix, `manage` implication and non-leakage, 401-vs-403
- `audit-logs.service.spec.ts` — credential redaction (including nested and in arrays) and field diffing
- `eligibility.spec.ts` — every exam eligibility rule, threshold inclusivity, provisional-result refusal, custom thresholds
- `pdf-renderer.service.spec.ts` — script segmentation and real PDF rendering (report card, certificate, multi-page, unknown sections). Skipped with a loud warning when no Lao font is installed

**Integration tests** run the real HTTP stack, guards included, against a real
MongoDB replica set:

- `auth.e2e-spec.ts` — login, username-enumeration resistance, forced password change, refresh-token rotation, reuse detection revoking all sessions, reset flow, account lockout, i18n
- `rbac.e2e-spec.ts` — every role's boundaries, teacher assignment scoping, student/guardian self-access, **record scoping** (a student cannot list or fetch another student's scores, attendance or results), the publication gate, system-role protection, suspension revoking live tokens
- `academic.e2e-spec.ts` — the locations tree, the guardian denormalization sync, enrollment capacity and uniqueness, transfers adjusting both headcounts, bulk-enroll partial failure, timetable conflicts, the full score → lock → amend → compute → rank → publish path, attendance idempotency
- `communication.e2e-spec.ts` — the lesson-plan review workflow end to end, exam eligibility and override, exam totals computed from marks, certificate numbering and public verification, announcement targeting and the no-double-publish rule, notification ownership, calendar overlap queries, feedback anonymity, report-template layout validation

Redis and S3 are stubbed in tests, so the suite needs no external services and runs
in CI unchanged.

---

## 10. Configuration

Every variable is validated at bootstrap by
[`src/config/configuration.ts`](src/config/configuration.ts) — a misconfigured
deployment fails immediately rather than at the first request that needs the value.
JWT secrets must be at least 32 characters, and starting in production with the
example secrets is refused outright.

See [`.env.example`](.env.example) for the full list. The ones that matter most:

| Variable                                             | Default      | Note                                                                      |
| ---------------------------------------------------- | ------------ | ------------------------------------------------------------------------- |
| `MONGODB_URI`                                        | —            | Must point at a replica set                                               |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`           | —            | ≥ 32 chars, distinct; `openssl rand -hex 48`                              |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL`                 | `15m` / `7d` | Short access token + rotating refresh                                     |
| `MAX_FAILED_LOGIN_ATTEMPTS` / `ACCOUNT_LOCK_MINUTES` | `5` / `15`   | Brute-force lockout                                                       |
| `CORS_ORIGINS`                                       | —            | Comma-separated whitelist. Empty means CORS is **off**, never "allow all" |
| `DEFAULT_LOCALE`                                     | `lo`         | `lo` or `en`                                                              |

---

## 11. Security notes

A full written review, including what is deliberately _not_ covered, is in
[`docs/security-review.md`](docs/security-review.md). In brief:

- **Passwords** — argon2id at the OWASP-recommended minimum (19 MiB, 2 iterations).
  Login against an unknown username still performs a hash verification, so response
  timing does not reveal which usernames exist.
- **Refresh tokens** — stored as SHA-256 hashes, bounded to 5 devices. Rotation is
  mandatory; replaying an already-rotated token revokes **every** session for that
  user, on the assumption it was stolen.
- **Token type** — a refresh token is a valid JWT too, so the strategy rejects one
  presented as a bearer credential.
- **Mass assignment** — `ValidationPipe` runs with `whitelist` and
  `forbidNonWhitelisted`, so unknown properties are rejected rather than persisted.
- **Regex injection** — all user input reaching a `$regex` filter goes through
  `escapeRegex()`.
- **Audit trail** — append-only, with credentials redacted before they are written and
  only changed fields recorded. Sensitive actions (post-lock score amendments, unlocks)
  require a stated reason that is stored verbatim.
- **Logs** — `Authorization`, cookies, and every password field are redacted by pino.
- **Swagger** — served in non-production only; the schema maps the whole attack surface.

---

## 12. Notes for whoever continues this

- **Adding a module:** follow the shape of an existing one — `enrollments` for
  transactional work, `grade-levels` for plain master data, `reports` for
  queue-backed work.
- **Anything student-scoped must call `RecordScopeService`.** A resource
  permission alone will hand students the whole school's data; this is the one
  mistake the codebase is most likely to repeat.
- **Multi-tenant, if it is ever needed:** every service reaches Mongo through
  `BaseCrudService`, which is the single place a `schoolId` scope would be applied.
- **Grade scale changes:** update the `grading.scale` setting _and_ bump
  `COMPUTATION_VERSION`, then recompute affected classes.
- **The denormalization contract:** `students.guardians[]` and the keys on `scores`
  are the only denormalized fields. `docs/schema-design.md` §3 names the single sync
  point for each. Adding another copy without a named sync point is how these drift.
