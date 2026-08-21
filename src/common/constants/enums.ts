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

export const GRADES = tuple('A', 'B+', 'B', 'C+', 'C', 'D+', 'D', 'F');
export type Grade = (typeof GRADES)[number];

export const CONDUCT_GRADES = tuple('excellent', 'very_good', 'good', 'fair', 'poor');
export type ConductGrade = (typeof CONDUCT_GRADES)[number];

export const CONDUCT_PERIOD_TYPES = tuple('monthly', 'semester', 'yearly');
export type ConductPeriodType = (typeof CONDUCT_PERIOD_TYPES)[number];

export const ATTENDANCE_STATUSES = tuple('present', 'absent', 'late', 'excused', 'sick');
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

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

export const CERTIFICATE_TYPES = tuple('graduation', 'completion', 'achievement', 'participation');
export type CertificateType = (typeof CERTIFICATE_TYPES)[number];

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

export const CALENDAR_EVENT_TYPES = tuple(
  'holiday',
  'exam',
  'meeting',
  'activity',
  'deadline',
  'other',
);
export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

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
  'term-results',
  'reports',
  'lesson-plans',
  'exams',
  'certificates',
  'announcements',
  'notifications',
  'calendar',
  'documents',
  'feedback',
  'audit-logs',
  'settings',
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
