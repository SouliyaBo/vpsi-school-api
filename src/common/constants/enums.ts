/**
 * Single source of truth for every enum in the system.
 *
 * Each enum is declared once as a `const` tuple, then derived into a TypeScript
 * union type and reused directly as the Mongoose `enum` validator — so the type
 * and the runtime validation can never drift apart.
 */

const tuple = <T extends readonly string[]>(...values: T) => values;

// ── People / accounts ───────────────────────────────────────────────────────

export const PERSON_TYPES = tuple('teacher', 'student', 'guardian', 'staff');
export type PersonType = (typeof PERSON_TYPES)[number];

export const USER_STATUSES = tuple('active', 'inactive', 'suspended');
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * The two boxes the Lao register actually has.
 *
 * There is no third option on the official form, so an unreadable cell is a row
 * to report rather than a value to store — `parseGender` returns `null` and the
 * importer reports it, the same way `parseSourceDate` refuses to guess a date.
 * A catch-all `other` was worse than a refusal: it filed "nobody has told us
 * yet" under an answer, and both the MoES tally and the honorific derived from
 * it then quietly excluded the row.
 */
export const GENDERS = tuple('male', 'female');
export type Gender = (typeof GENDERS)[number];

/**
 * The honorific the register writes for each gender — `ນາງ` and `ທ້າວ`.
 *
 * The register's own sheets abbreviate the same two words four ways (`ນາງ`,
 * `ນ.`, `ທ້າວ`, `ທ.`, plus blanks), which is typing rather than meaning. Since
 * the title is fully determined by the gender, it is derived on read as a
 * virtual instead of stored, so the two can never disagree.
 */
export const TITLE_BY_GENDER: Record<Gender, string> = {
  male: 'ທ້າວ',
  female: 'ນາງ',
};

/**
 * `new` is the pre-placement state: registered at the office but not yet in a
 * classroom. It is kept apart from `active` so the placement queue is a status
 * filter rather than a join against enrollments.
 *
 * `no_certificate` marks a student who finished the year but declined the
 * certificate — distinct from `graduated`, which the certificate module treats
 * as issuable.
 */
export const STUDENT_STATUSES = tuple(
  'new',
  'active',
  'graduated',
  'no_certificate',
  'transferred',
  'dropped',
  'suspended',
);
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

/**
 * The statuses that make up the current roll — the children the school is
 * teaching right now.
 *
 * `no_certificate` sits beside `active` because declining the certificate says
 * nothing about attendance: the child is still in a classroom, still on the
 * score sheets, and still expected in a roster. Only the certificate module
 * cares about the difference.
 */
export const CURRENT_ROLL_STUDENT_STATUSES = tuple('active', 'no_certificate');

/**
 * The mass organisations a student is enrolled into — `ເຍົາວະຊົນ`,
 * `ເຂົ້າຊາວໜຸ່ມ`, `ເຂົ້າແມ່ຍິງ`.
 *
 * Membership is an act with a date, not a property of the person, so it is
 * never derived from `gender` or age: a girl in ມ.1 is a student but not yet in
 * the women's union, and the MoES report wants the member count and the female
 * student count as two separate figures. A student holds several at once — a
 * girl in ມ.5 is in both `youth` and `women` — and `children` gives way to
 * `youth` at around fifteen, which is history worth keeping rather than an
 * overwrite. Hence a list, not a field.
 */
export const STUDENT_ORGANIZATIONS = tuple('children', 'youth', 'women');
export type StudentOrganization = (typeof STUDENT_ORGANIZATIONS)[number];

// ── Health ──────────────────────────────────────────────────────────────────

/**
 * The vaccines given through a school campaign here.
 *
 * `hpv` and `td` are the ones the health centre brings for girls of a given age;
 * `mr` and `je` are given to whole cohorts. Which students a round covers is a
 * property of the campaign, never of the vaccine — so the next whole-school
 * round needs no new value here, and nothing in this list implies a gender.
 */
export const VACCINES = tuple('hpv', 'td', 'mr', 'je', 'covid', 'other');
export type Vaccine = (typeof VACCINES)[number];

/**
 * What happened to one student for one dose.
 *
 * `refused`, `absent` and `contraindicated` are recorded rather than left as a
 * missing row, because "no record" would otherwise mean both "not vaccinated"
 * and "never asked" — and the follow-up list is built from exactly that
 * difference. `scheduled` is the state between a campaign being planned and the
 * health centre arriving.
 */
export const VACCINATION_STATUSES = tuple(
  'scheduled',
  'administered',
  'refused',
  'absent',
  'contraindicated',
);
export type VaccinationStatus = (typeof VACCINATION_STATUSES)[number];

/** `ໃບຍິນຍອມ` from the guardian, which a dose may not be given without. */
export const CONSENT_STATUSES = tuple('pending', 'given', 'refused');
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const VACCINATION_CAMPAIGN_STATUSES = tuple('planned', 'active', 'completed', 'cancelled');
export type VaccinationCampaignStatus = (typeof VACCINATION_CAMPAIGN_STATUSES)[number];

export const TEACHER_STATUSES = tuple('active', 'on_leave', 'resigned', 'retired');
export type TeacherStatus = (typeof TEACHER_STATUSES)[number];

/**
 * Marital status as the staff register records it.
 *
 * `engaged` is not a legal status anywhere, but the register writes `ມີແຟນ` on
 * roughly a third of the rows and folding it into `single` would throw away the
 * distinction the school itself chose to make.
 */
export const MARITAL_STATUSES = tuple('single', 'engaged', 'married', 'divorced', 'widowed');
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];

/**
 * Who owns the roof a staff member lives under.
 *
 * Kept as a small enum rather than free text because the register only ever
 * writes these five, and housing feeds the school's allowance calculations —
 * `ເຊົ່າຫ້ອງ` and `ເຮືອນຕົນເອງ` must be countable, not merely readable.
 */
export const HOUSING_TYPES = tuple('own', 'rented', 'parents', 'relatives', 'other');
export type HousingType = (typeof HOUSING_TYPES)[number];

export const GUARDIAN_RELATIONSHIPS = tuple(
  'father',
  'mother',
  'grandfather',
  'grandmother',
  'uncle',
  'aunt',
  'sibling',
  'legal_guardian',
  'other',
);
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];

// ── Locations ───────────────────────────────────────────────────────────────

export const LOCATION_TYPES = tuple('province', 'district', 'village');
export type LocationType = (typeof LOCATION_TYPES)[number];

// ── Academic structure ──────────────────────────────────────────────────────

export const SEMESTER_STATUSES = tuple('upcoming', 'active', 'grading', 'closed');
export type SemesterStatus = (typeof SEMESTER_STATUSES)[number];

export const ENROLLMENT_STATUSES = tuple(
  'active',
  'transferred',
  'promoted',
  'dropped',
  'repeated',
);
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const SUBJECT_TYPES = tuple('core', 'elective', 'extracurricular');
export type SubjectType = (typeof SUBJECT_TYPES)[number];

// ── Assessment ──────────────────────────────────────────────────────────────

export const SCORE_COMPONENT_TYPES = tuple(
  'attendance',
  'homework',
  'quiz',
  'participation',
  'project',
  'midterm',
  'final',
  'other',
);
export type ScoreComponentType = (typeof SCORE_COMPONENT_TYPES)[number];

/**
 * The school's letter grades, best first.
 *
 * A–F with an **E**, and none of the `+` bands: this is the scale VPSI marks on,
 * given by the office as marks out of 10 — A 8.5–10 · B 7–8.4 · C 5.5–6.9 ·
 * D 4.5–5.4 · E 3.5–4.4 · F 0–3.4. The thresholds live in `DEFAULT_GRADE_SCALE`
 * as percentages, which is the same numbers times ten.
 */
export const GRADES = tuple('A', 'B', 'C', 'D', 'E', 'F');
export type Grade = (typeof GRADES)[number];

export const CONDUCT_GRADES = tuple('excellent', 'very_good', 'good', 'fair', 'poor');
export type ConductGrade = (typeof CONDUCT_GRADES)[number];

export const CONDUCT_PERIOD_TYPES = tuple('monthly', 'semester', 'yearly');
export type ConductPeriodType = (typeof CONDUCT_PERIOD_TYPES)[number];

/**
 * Where a conduct score came from.
 *
 * The school runs a deduction ledger — every child starts a term on 100 and
 * loses points against a published rule — so the term's conduct score is a
 * consequence of that ledger rather than a judgement typed in at the end. The
 * two still coexist: `manual` is a mark the office set itself, and the ledger
 * refuses to overwrite one, because a headteacher's own decision must not be
 * undone by the next deduction.
 */
export const CONDUCT_SCORE_SOURCES = tuple('manual', 'deductions');
export type ConductScoreSource = (typeof CONDUCT_SCORE_SOURCES)[number];

/**
 * How far a child's deductions have to be escalated, per the school's own
 * ໝາຍເຫດ on the rule sheet.
 *
 * Named for the rungs the sheet names — `classroom` is ຂັ້ນຫ້ອງ, then ຂັ້ນ 1, 2
 * and 3 — rather than for what each rung means, so the ladder can be read
 * against the paper it came from. `review` is the last line: at a full 100 the
 * child's place at the school is reconsidered.
 */
export const CONDUCT_ESCALATION_LEVELS = tuple(
  'none',
  'classroom',
  'level1',
  'level2',
  'level3',
  'review',
);
export type ConductEscalationLevel = (typeof CONDUCT_ESCALATION_LEVELS)[number];

/**
 * Who the sheet says must be told at each rung.
 *
 * Kept as parties rather than as a sentence so the screen can render the list in
 * either language, and so a rung's audience is comparable between rungs.
 */
export const CONDUCT_NOTIFY_PARTIES = tuple(
  'homeroomTeacher',
  'student',
  'disciplineCommittee',
  'studentAffairs',
  'guardian',
  'director',
);
export type ConductNotifyParty = (typeof CONDUCT_NOTIFY_PARTIES)[number];

export const ATTENDANCE_STATUSES = tuple('present', 'absent', 'late', 'excused', 'sick');
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

// ── Homeroom review (ການຕິດຕາມນັກຮຽນຂອງຄູປະຈຳຫ້ອງ) ──────────────────────────

/**
 * What the homeroom teacher did about a child they flagged.
 *
 * The list is ordered by escalation, and `none` is deliberately available: a
 * teacher who looked at a flagged child and judged that nothing was wrong has
 * reviewed the class, and forcing them to claim an action would turn the record
 * into a fiction. What the office chases is the review, not a contact per name.
 */
export const HOMEROOM_REVIEW_ACTIONS = tuple(
  'none',
  'watching',
  'warned_student',
  'met_student',
  'contacted_guardian',
  'referred_discipline',
);
export type HomeroomReviewAction = (typeof HOMEROOM_REVIEW_ACTIONS)[number];

/**
 * How a guardian was reached.
 *
 * Recorded because "ແຈ້ງຜູ້ປົກຄອງແລ້ວ" is the claim a later meeting is held
 * over, and "I rang and nobody answered" is a different fact from a letter the
 * child was handed. `null` on any action that did not reach out at all.
 */
export const GUARDIAN_CONTACT_CHANNELS = tuple('phone', 'telegram', 'in_person', 'letter');
export type GuardianContactChannel = (typeof GUARDIAN_CONTACT_CHANNELS)[number];

/**
 * Why a child appeared on the review sheet.
 *
 * Snapshotted onto the filed review rather than recomputed: the sheet is what
 * the teacher was looking at when they acted, and a threshold the office retunes
 * in November must not rewrite what October's review says it was about.
 */
export const HOMEROOM_ANOMALY_KINDS = tuple(
  'absence',
  'late',
  'attendance_rate',
  'behavior',
  'conduct',
);
export type HomeroomAnomalyKind = (typeof HOMEROOM_ANOMALY_KINDS)[number];

/** Whether a reason was raised by the days since the last review, or by the term to date. */
export const HOMEROOM_ANOMALY_SCOPES = tuple('window', 'term');
export type HomeroomAnomalyScope = (typeof HOMEROOM_ANOMALY_SCOPES)[number];

// ── Documents / reports ─────────────────────────────────────────────────────

export const REPORT_TYPES = tuple(
  'report_card',
  'transcript',
  'guardian_summary',
  'authority_summary',
  'certificate',
  'attendance_summary',
);
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_STATUSES = tuple('queued', 'processing', 'completed', 'failed');
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const DOCUMENT_VISIBILITIES = tuple('staff', 'all', 'teachers', 'guardians');
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number];

// ── Lesson plans ────────────────────────────────────────────────────────────

export const LESSON_PLAN_STATUSES = tuple(
  'draft',
  'submitted',
  'under_review',
  'approved',
  'returned',
);
export type LessonPlanStatus = (typeof LESSON_PLAN_STATUSES)[number];

// ── Teaching observation (ຕິດຕາມການສອນຂອງຄູ) ────────────────────────────────

/**
 * The life of one observation sheet.
 *
 * `draft` is the observer's own copy — filled in at the back of the room, half
 * scored, and visible to nobody else. `submitted` is the moment it becomes a
 * record about another member of staff, which is why the sheet is refused
 * unless all six criteria carry a mark: a partly scored sheet filed against a
 * colleague is a total that cannot be compared with anyone else's.
 *
 * `acknowledged` is the observed teacher saying they have read it — the digital
 * form of the signature the paper sheet is passed back for. It is deliberately
 * theirs alone to set, so "the teacher has seen this" never becomes something
 * the office can assert on their behalf.
 */
export const TEACHING_OBSERVATION_STATUSES = tuple('draft', 'submitted', 'acknowledged');
export type TeachingObservationStatus = (typeof TEACHING_OBSERVATION_STATUSES)[number];

// ── Exam papers (ບົດສອບປາລະໄນ) ──────────────────────────────────────────────

/**
 * How a paper letters its options — `A. B. C. D.` or `ກ. ຂ. ຄ. ງ.`. Read off
 * the teacher's file, and printed back the same way on every set.
 */
export const EXAM_OPTION_LABEL_STYLES = tuple('latin', 'lao');
export type ExamOptionLabelStyle = (typeof EXAM_OPTION_LABEL_STYLES)[number];

// ── Exams / certificates ────────────────────────────────────────────────────

export const EXAM_LEVELS = tuple('m4', 'm7');
export type ExamLevel = (typeof EXAM_LEVELS)[number];

export const EXAM_REGISTRATION_STATUSES = tuple(
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'completed',
);
export type ExamRegistrationStatus = (typeof EXAM_REGISTRATION_STATUSES)[number];

/**
 * `study_verification` is `ໃບຢັ້ງຢືນການສຶກສາ` — the letter the office writes for a
 * pupil who needs to prove to somebody outside the school that they study here.
 * `study_suspension` is `ບົດບັນທຶກ ຂໍໂຈະການຮຽນ` — the memo a parent signs to take
 * a pupil off the Lao-programme roll. Neither is an award, so neither carries
 * marks and, unlike the other four, both are rendered as formal letters rather
 * than as a certificate face.
 */
export const CERTIFICATE_TYPES = tuple(
  'graduation',
  'completion',
  'achievement',
  'participation',
  'study_verification',
  'study_suspension',
);
export type CertificateType = (typeof CERTIFICATE_TYPES)[number];

/**
 * The types numbered from the school's register of outgoing documents —
 * `99/ວຈພທນ(ຄນຮ)` — as one running series, the way the paper book is kept.
 * The award types have their own `<year>/<TYPE>/<ordinal>` series.
 */
export const REGISTER_LETTER_TYPES = tuple('study_verification', 'study_suspension');
export type RegisterLetterType = (typeof REGISTER_LETTER_TYPES)[number];

// ── Communication ───────────────────────────────────────────────────────────

export const ANNOUNCEMENT_TARGET_TYPES = tuple(
  'all',
  'role',
  'grade_level',
  'classroom',
  'guardians',
  'teachers',
);
export type AnnouncementTargetType = (typeof ANNOUNCEMENT_TARGET_TYPES)[number];

export const ANNOUNCEMENT_PRIORITIES = tuple('low', 'normal', 'high', 'urgent');
export type AnnouncementPriority = (typeof ANNOUNCEMENT_PRIORITIES)[number];

export const NOTIFICATION_TYPES = tuple(
  'score_published',
  'announcement',
  'lesson_plan_returned',
  'lesson_plan_due',
  'attendance_alert',
  'report_ready',
  'exam_result',
  'general',
);
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * The categories the school's own printed calendar uses, plus the general-purpose
 * ones the module started with.
 *
 * The first nine are the legend of `SCHOOL CALENDAR — SECONDARY` exactly as it is
 * printed, in its own order, because the office fills this in by reading the paper
 * across: a category the sheet has and the picker does not is a row somebody has
 * to file as `other`, and `other` is precisely the answer no working-day
 * calculation can use. `meeting`, `activity`, `deadline` and `other` are kept for
 * everything the sheet does not print — a staff meeting, a deadline — and for the
 * events already on file under them.
 */
export const CALENDAR_EVENT_TYPES = tuple(
  'first_day',
  'year_end_program',
  'holiday',
  'celebration',
  'exam',
  'lao_exam',
  'report_card',
  'open_house',
  'professional_development',
  'meeting',
  'activity',
  'deadline',
  'other',
);
export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

/**
 * What a calendar event does to the school day — the one thing every other module
 * needs from the calendar.
 *
 * Kept apart from `type` because the two answer different questions and the school
 * does not map one onto the other cleanly. `6 Oct Teacher's Day celebrated at
 * School` and `7 Oct Holiday for Teachers' Day` are the same festival on
 * consecutive days, and only the second closes the school; an exam week is open,
 * fully staffed, and teaches no timetabled lesson at all. So:
 *
 * - `open` — a normal day. Lessons run, the roll call and the behaviour register
 *   are owed. A celebration or a report-card distribution is still this.
 * - `no_classes` — staff in, timetable suspended. Teacher PD days ("no school for
 *   students") and exam periods. Nothing is owed, and a report that counted these
 *   as gaps would blame every teacher in the school for a week the office closed.
 * - `closed` — nobody in.
 *
 * The distinction between the last two matters to nothing the system currently
 * computes, and is kept because it is what the office means and the day it stops
 * being recorded is the day somebody has to guess it back.
 */
export const SCHOOL_DAY_EFFECTS = tuple('open', 'no_classes', 'closed');
export type SchoolDayEffect = (typeof SCHOOL_DAY_EFFECTS)[number];

/**
 * The effect a type carries unless the event overrides it.
 *
 * A default, not a rule: the office can mark one celebration as closing the school
 * without the picker having to grow a category for it.
 */
export const DEFAULT_DAY_EFFECT: Record<CalendarEventType, SchoolDayEffect> = {
  first_day: 'open',
  year_end_program: 'open',
  holiday: 'closed',
  celebration: 'open',
  exam: 'no_classes',
  lao_exam: 'no_classes',
  report_card: 'open',
  open_house: 'open',
  professional_development: 'no_classes',
  meeting: 'open',
  activity: 'open',
  deadline: 'open',
  other: 'open',
};

export const FEEDBACK_STATUSES = tuple('new', 'read', 'resolved', 'archived');
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

// ── Authorization ───────────────────────────────────────────────────────────

export const PERMISSION_ACTIONS = tuple(
  'create',
  'read',
  'update',
  'delete',
  'approve',
  'export',
  'manage',
);
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/**
 * Every resource the permission matrix can grant access to.
 * `RequirePermissions()` accepts only these values, so a typo is a compile error.
 */
export const PERMISSION_RESOURCES = tuple(
  'users',
  'roles',
  'teachers',
  'students',
  'guardians',
  'locations',
  'school-years',
  'semesters',
  'grade-levels',
  'classrooms',
  'subject-groups',
  'subjects',
  'teaching-assignments',
  'enrollments',
  'score-components',
  'scores',
  'conduct-scores',
  'behavior-logs',
  'attendances',
  // ການມອບໝາຍສອນແທນ — gated apart from `attendances` and `behavior-logs` because
  // it is the *key* to them rather than one of them: a claim is what lets a
  // teacher who is not on the timetable write that lesson's register at all, so
  // who may hand that key out is a narrower question than who may use it.
  'lesson-substitutions',
  'term-results',
  'reports',
  'lesson-plans',
  // Kept apart from `teachers` and from `lesson-plans`: an observation is a
  // judgement one member of staff writes about another, so who may read the
  // sheets is a narrower question than who may read the staff register, and
  // narrower again than who reviews the plans they teach from.
  'teaching-observations',
  // A teacher's unprinted exam paper is theirs alone until the day of the
  // exam, so the papers are not a facet of `exams` (registrations and
  // results, which the office runs) nor of `documents` (the shared library).
  'exam-papers',
  'exams',
  'certificates',
  'announcements',
  'notifications',
  'calendar',
  'documents',
  'feedback',
  'audit-logs',
  'settings',
  // Who checked their class, and what they did about it — gated apart from
  // `behavior-logs` and `attendances` because it is the *oversight* of the two:
  // a teacher who may write a register row is not thereby a party to the report
  // that names which homeroom teachers have stopped looking at their room.
  'homeroom-reviews',
  // Health data is gated on its own resource rather than riding on `students`:
  // the office maintains the register, but a child's HPV record is the nurse's,
  // and one permission for both would mean granting either to grant the other.
  'vaccinations',
);
export type PermissionResource = (typeof PERMISSION_RESOURCES)[number];

// ── Audit ───────────────────────────────────────────────────────────────────

export const AUDIT_ACTIONS = tuple(
  'create',
  // Recorded for health data only. Reading a child's vaccination history is
  // itself the sensitive act, so it leaves a trail; ordinary reads do not, or
  // every list request would drown the log.
  'read',
  'update',
  'delete',
  'login',
  'logout',
  'login_failed',
  'password_change',
  'password_reset',
  'lock',
  'unlock',
  'approve',
  'reject',
  'export',
);
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
