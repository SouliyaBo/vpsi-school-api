# Security review

Review of the implemented system (Phases 0–6) against the non-functional
requirements in the brief. Written to be read by whoever operates this, so it
names what is **not** covered as plainly as what is.

Last reviewed: 2026-08-06 · scope: `src/`, `Dockerfile`, `docker-compose.yml`, CI

---

## 1. Summary

| Area | State |
|---|---|
| Authentication | ✅ argon2id, timing-equalized, brute-force lockout |
| Session management | ✅ Short access token, rotating refresh with reuse detection |
| Authorization | ✅ Deny-by-default guard chain, permission matrix, per-record ownership rules |
| Input validation | ✅ Global whitelist + reject-unknown, typed DTOs everywhere |
| Injection | ✅ No raw queries; all user input reaching `$regex` is escaped |
| Data at rest | 🟡 No field-level encryption (see §6) |
| Data in transit | 🟡 TLS terminates upstream; not configured here (see §6) |
| Secrets | ✅ Validated at boot; example secrets refused in production |
| Audit | ✅ Append-only, redacted, reason required for sensitive actions |
| File handling | ✅ Type/size limits, random keys, signed short-lived URLs |
| Rate limiting | ✅ Global + tighter per-endpoint limits on auth and public routes |
| Dependency risk | 🟡 `npm audit` reports advisories (see §7) |

---

## 2. Authentication

**Password storage** — argon2id at the OWASP minimum (19 MiB memory, 2
iterations, 1 lane). Not bcrypt: argon2id resists GPU and ASIC attack
considerably better at equivalent latency.

**Username enumeration** — a login against an unknown username still performs a
full argon2 verification against a dummy hash
(`AuthService.verifyAgainstDummy`), so the response time does not distinguish
"no such user" from "wrong password". Both return the identical `messageKey`.
Covered by `auth.e2e-spec.ts` → *"gives the same response for an unknown
username as for a wrong password"*.

**Account status leakage** — status is checked *after* the password verifies, so
a guesser cannot discover that an account exists but is suspended.

**Brute force** — 5 failed attempts locks the account for 15 minutes
(configurable). The lockout returns a distinct `auth.accountLocked` key only
*after* the correct password is supplied, so it does not itself become an oracle.

**Password policy** — minimum 8 characters with lower, upper and a digit,
enforced on every path that sets a password. Symbols are permitted but not
required; mandating them pushes users toward predictable substitutions.

### Not covered

- **No MFA.** Out of scope for the brief. The natural place is a `totpSecret`
  on `users` plus a second step in `AuthService.login`.
- **No password history**; a user may set their previous password again.
- **No breach-corpus check** (e.g. Have I Been Pwned k-anonymity).

---

## 3. Sessions and tokens

- Access tokens are short-lived (15 min default) and carry no permissions —
  `JwtStrategy` re-reads the user on every request, so a suspension or role
  change applies immediately rather than at token expiry. Verified in
  `rbac.e2e-spec.ts` → *"revokes sessions when an account is suspended"*.
- Refresh tokens are stored as **SHA-256 hashes**, never in the clear, and are
  bounded to 5 devices per account.
- **Rotation is mandatory and reuse is treated as theft**: presenting an
  already-rotated refresh token revokes every session for that user. Verified in
  `auth.e2e-spec.ts`.
- A refresh token is a valid JWT, so `JwtStrategy` explicitly rejects `typ !==
  'access'` — otherwise a refresh token would work as a bearer credential.
- Changing a password clears all refresh tokens.

### Not covered

- Tokens are **not** revocable individually before expiry beyond the refresh
  mechanism; a stolen *access* token remains valid for up to its TTL. Shortening
  `JWT_ACCESS_TTL` is the mitigation; a denylist in Redis would be the fix.
- No device/session listing endpoint for users to audit their own sessions.

---

## 4. Authorization

Three guards run globally, in order: throttle → authenticate → authorize.

**Deny by default.** `JwtAuthGuard` is global; a route is public only if it
carries `@Public()`. A new endpoint added without any decorator is
authenticated, not open. The public surface is deliberately tiny:

| Route | Why public | Protection |
|---|---|---|
| `POST /auth/login`, `/refresh`, `/forgot-password`, `/reset-password` | Pre-authentication | Tight per-endpoint throttles |
| `GET /settings/public` | Login screen needs the school name before a token exists | Only rows flagged `isPublic` |
| `GET /certificates/verify/:number` | An employer must be able to check a certificate | 20 req/min; returns name + validity only, no marks or contacts |
| `GET /health`, `/health/ready` | Orchestrator probes | Throttle-exempt by design |

**Beyond the matrix.** Two rules cannot be expressed as resource permissions and
are enforced in the services, with tests:

- A teacher may only enter scores for the subject *and* classroom they are
  assigned to (`ScoresService.assertCanGrade`). Holding `scores:create` is not
  sufficient. `scores:manage` bypasses it so the academic office can correct
  marks for a teacher who has left.
- Students and guardians may read only their own records; a guardian
  additionally needs `canViewRecords` on the link, and term results and exam
  results are hidden until published.

**Privilege escalation paths considered:**

- System roles cannot be deleted, and their permission sets cannot be edited —
  otherwise an admin could remove `admin`'s own grants and lock everyone out
  irrecoverably.
- `UpdateUserDto` excludes `username`, `personType`, `personId` and `password`,
  so an account cannot be re-pointed at a different person or have its password
  set without going through the audited reset endpoint.
- `LessonPlansService.create` takes the owning teacher from the token, never
  from the body.

---

## 5. Input handling

- `ValidationPipe` runs with `whitelist: true` and `forbidNonWhitelisted: true`
  globally: unknown properties are rejected, not silently dropped. This is the
  mass-assignment defence and is covered by a test.
- `disableErrorMessages` in production, so constraint internals are not echoed.
- **No raw queries anywhere.** All access goes through Mongoose with typed
  filters.
- Every user string that reaches a `$regex` passes through `escapeRegex()`
  (`users.service.ts`), so a crafted search term cannot alter the pattern or
  mount a ReDoS via nested quantifiers.
- `?sortBy=` is whitelisted per endpoint; an arbitrary field would force an
  unindexed collection scan, which is a denial-of-service vector as much as a
  performance one.
- Page size is capped at 100.

### Residual risk

- `settings.value`, `reportTemplates.layout` and `auditLogs.oldValue/newValue`
  are `Mixed`. Their content is not schema-validated (report layouts are checked
  structurally by `ReportTemplatesService.assertValidLayout`). Only
  `settings:update` and `reports:manage` holders can write them.
- A regex search still costs a collection scan on very large collections even
  when escaped. Mitigated by pagination caps; the text indexes cover the common
  case.

---

## 6. Data protection

**In transit.** The app speaks plain HTTP and expects TLS to terminate at a
reverse proxy or load balancer. `trust proxy` is enabled so `X-Forwarded-For`
reaches the audit log. **Deploying this without TLS in front of it would expose
credentials and student data**; that is an operational requirement, not
something the code can enforce.

**At rest.** No field-level encryption. Student national IDs, dates of birth and
guardian phone numbers are stored in the clear. For MongoDB Atlas, enable
encryption at rest (on by default) and consider Queryable Encryption for
`nationalId` if the threat model includes a database-level compromise.

**Files.** Only object *keys* are stored, never URLs. Downloads are short-lived
signed URLs (15 min default), so a leaked database row does not grant access to
a student's photo or report card. Uploads are constrained by MIME type and size,
and stored under a random UUID key — the original filename is never used as a
path, which rules out traversal and collision.

**Personal data in logs.** pino redacts `authorization`, cookies, and every
password field. The audit log redacts credentials before writing
(`redactSensitive`, recursive, covers arrays and nesting) and stores only changed
fields rather than whole documents.

**Anonymous feedback is genuinely anonymous.** When `isAnonymous` is set, no user
id and no IP are stored — not on the record and not in the audit row. This is
deliberate: anonymity an administrator can undo by reading the database is not
anonymity, and people will not report problems honestly if it can be.

**Retention.** `notifications` expire after 90 days and `auditLogs` after 2
years, via TTL indexes. **Audit rows that must be kept longer have to be exported
to cold storage before the TTL reaches them** — there is no such job yet, and
that is a gap for anyone with a statutory retention period.

---

## 7. Dependencies and supply chain

`npm audit` currently reports advisories, the bulk of them transitive
(development tooling and the `@nestjs/cli` chain). None is known to be
exploitable in the running server, but this should be re-checked before each
deploy:

```bash
npm audit --omit=dev        # what actually ships
npm audit                   # including build tooling
```

CI runs lint, build, unit and e2e on every push. It does **not** yet run
`npm audit --audit-level=high`, a licence check, or image scanning (Trivy or
equivalent) — worth adding before this is exposed publicly.

The production image runs as a non-root `app` user and contains no build
toolchain.

---

## 8. Recommendations, in priority order

1. **Terminate TLS in front of the API** and set HSTS at the proxy. Nothing else
   here matters if traffic is plaintext.
2. **Rotate the seeded admin password** and set `SEED_ADMIN_PASSWORD` in every
   environment. The default is documented and therefore public.
3. **Rotate any credential that has ever been pasted into a chat, ticket or
   commit** — including the MongoDB Atlas connection string.
4. **Restrict Atlas network access** to the application's egress addresses
   rather than `0.0.0.0/0`, and give the application user only
   `readWrite` on its own database rather than `atlasAdmin`.
5. Add `npm audit --audit-level=high` and image scanning to CI.
6. Add an audit-log export job before the 2-year TTL becomes a compliance
   problem.
7. Consider MFA for `admin` and `academic_head`, the two roles that can alter
   grades and permissions.
8. Add a session-listing endpoint so users can see and revoke their own devices.

---

## 9. How to re-run the checks

```bash
npm run lint && npm run build       # static analysis
npm test && npm run test:e2e        # includes the authz and session tests
npm audit --omit=dev                # runtime dependency advisories
k6 run test/load/k6-smoke.js        # sustained-load behaviour
```

The authorization boundaries are covered by `test/rbac.e2e-spec.ts` and the
session and credential handling by `test/auth.e2e-spec.ts`. Those two files are
the executable form of §3 and §4 — if a change breaks a boundary described here,
they should fail.
