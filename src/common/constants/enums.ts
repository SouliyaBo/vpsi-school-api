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

export const GENDERS = tuple('male', 'female', 'other');
export type Gender = (typeof GENDERS)[number];

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
);
export type PermissionResource = (typeof PERMISSION_RESOURCES)[number];

// ── Audit ───────────────────────────────────────────────────────────────────

export const AUDIT_ACTIONS = tuple(
  'create',
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
