import {
  PERMISSION_RESOURCES,
  PermissionAction,
  PermissionResource,
} from 'src/common/constants/enums';

export interface RoleSeed {
  code: string;
  nameLo: string;
  nameEn: string;
  description: string;
  isSystem: boolean;
  permissions: { resource: PermissionResource; actions: PermissionAction[] }[];
}

const manageAll = (): { resource: PermissionResource; actions: PermissionAction[] }[] =>
  PERMISSION_RESOURCES.map((resource) => ({ resource, actions: ['manage'] as PermissionAction[] }));

const readOnly = (
  ...resources: PermissionResource[]
): { resource: PermissionResource; actions: PermissionAction[] }[] =>
  resources.map((resource) => ({ resource, actions: ['read'] as PermissionAction[] }));

/**
 * The permission matrix, seeded once and editable afterwards through the API
 * (except for system roles, whose permissions are fixed).
 *
 * `manage` implies every action on a resource — see PermissionsGuard.
 */
export const ROLE_SEEDS: RoleSeed[] = [
  {
    code: 'admin',
    nameLo: 'ຜູ້ບໍລິຫານລະບົບ',
    nameEn: 'System Administrator',
    description: 'Full access to every resource.',
    isSystem: true,
    permissions: manageAll(),
  },

  {
    code: 'academic_head',
    nameLo: 'ຫົວໜ້າວິຊາການ',
    nameEn: 'Head of Academic Affairs',
    description:
      'Runs academic operations: curriculum, assignments, grading oversight, lesson-plan ' +
      'approval and classroom observation. Cannot manage user accounts or roles.',
    isSystem: true,
    permissions: [
      { resource: 'teachers', actions: ['read', 'update'] },
      { resource: 'students', actions: ['read', 'update'] },
      { resource: 'guardians', actions: ['read'] },
      { resource: 'school-years', actions: ['read'] },
      { resource: 'semesters', actions: ['read', 'update'] },
      { resource: 'grade-levels', actions: ['read'] },
      { resource: 'classrooms', actions: ['manage'] },
      { resource: 'subject-groups', actions: ['manage'] },
      { resource: 'subjects', actions: ['manage'] },
      { resource: 'teaching-assignments', actions: ['manage'] },
      { resource: 'enrollments', actions: ['manage'] },
      { resource: 'score-components', actions: ['manage'] },
      // `manage` here is what lets the academic office unlock and correct
      // submitted grades — see ScoresController.unlock.
      { resource: 'scores', actions: ['manage'] },
      { resource: 'conduct-scores', actions: ['manage'] },
      { resource: 'behavior-logs', actions: ['manage'] },
      { resource: 'attendances', actions: ['manage'] },
      { resource: 'term-results', actions: ['manage'] },
      { resource: 'reports', actions: ['create', 'read', 'export'] },
      { resource: 'lesson-plans', actions: ['read', 'approve'] },
      // `manage` is what makes the academic office the one party that reads
      // every observation sheet, keys in a deputy's handwritten one under that
      // deputy's name, and withdraws a sheet that has already been filed.
      { resource: 'teaching-observations', actions: ['manage'] },
      // `manage` is what lets the office open any teacher's paper — to print
      // a set for a colleague who is away, or to check one before it is sat.
      { resource: 'exam-papers', actions: ['manage'] },
      { resource: 'exams', actions: ['manage'] },
      { resource: 'certificates', actions: ['create', 'read'] },
      { resource: 'announcements', actions: ['manage'] },
      { resource: 'calendar', actions: ['manage'] },
      { resource: 'documents', actions: ['manage'] },
      { resource: 'audit-logs', actions: ['read'] },
      ...readOnly('locations', 'notifications', 'feedback'),
    ],
  },

  {
    code: 'teacher',
    nameLo: 'ຄູສອນ',
    nameEn: 'Teacher',
    description:
      'Enters scores, conduct, attendance and the behaviour register for their own classes, ' +
      'submits lesson plans, and fills in the classroom-observation sheet for colleagues they ' +
      'sit in on. Score and behaviour entry are additionally restricted to the ' +
      'subjects and classrooms they are assigned to — the permission alone is not sufficient. ' +
      'Reading and correcting student records is likewise narrowed to the classroom they are ' +
      'homeroom teacher of.',
    isSystem: true,
    permissions: [
      // `create` and `update` so the homeroom teacher — the one person who
      // actually sees the child every day — can add a newcomer and correct a
      // wrong phone number or spelling on the register. StudentsService narrows
      // reads and writes to their own homeroom and refuses a change to `status`,
      // which is the office's call. No `delete`: removing a child from the
      // register stays with the registrar.
      { resource: 'students', actions: ['read', 'create', 'update'] },
      { resource: 'guardians', actions: ['read'] },
      { resource: 'teachers', actions: ['read'] },
      { resource: 'classrooms', actions: ['read'] },
      { resource: 'subject-groups', actions: ['read'] },
      { resource: 'subjects', actions: ['read'] },
      { resource: 'teaching-assignments', actions: ['read'] },
      // A new student who is never placed is invisible to the teacher who just
      // added them, so creating one has to come with placing them. Narrowed by
      // EnrollmentsService to the teacher's own homeroom — they cannot pull a
      // child into someone else's room, and moving or removing an enrolment
      // still needs `update`/`delete`, which they do not have.
      { resource: 'enrollments', actions: ['read', 'create'] },
      { resource: 'score-components', actions: ['create', 'read', 'update'] },
      // Deliberately no `manage`: a teacher can submit and lock grades but not
      // reopen them.
      { resource: 'scores', actions: ['create', 'read', 'update'] },
      { resource: 'conduct-scores', actions: ['create', 'read', 'update'] },
      // `delete` unlike the others: a behaviour row is a free-text diary entry, so
      // the wrong one is withdrawn rather than corrected. Every write is further
      // restricted to the teacher's own lessons — see BehaviorLogsService.
      { resource: 'behavior-logs', actions: ['create', 'read', 'update', 'delete'] },
      { resource: 'attendances', actions: ['create', 'read', 'update'] },
      { resource: 'term-results', actions: ['read'] },
      { resource: 'lesson-plans', actions: ['create', 'read', 'update', 'delete'] },
      // Observing a colleague is ordinary staff work here — a head of department
      // sits in on their own team. No `manage`, so a teacher files only under
      // their own name; and the service narrows this `read` to the sheets they
      // wrote plus the sheets written about them, which the permission alone
      // cannot express. `delete` withdraws a draft of their own, never a filed one.
      { resource: 'teaching-observations', actions: ['create', 'read', 'update', 'delete'] },
      // Full rights, narrowed in the service to the teacher's own papers.
      { resource: 'exam-papers', actions: ['create', 'read', 'update', 'delete'] },
      { resource: 'reports', actions: ['read'] },
      ...readOnly(
        'locations',
        'school-years',
        'semesters',
        'grade-levels',
        'announcements',
        'notifications',
        'calendar',
        'documents',
      ),
    ],
  },

  {
    code: 'registrar',
    nameLo: 'ພະນັກງານທະບຽນ',
    nameEn: 'Registrar',
    description:
      'Maintains student, guardian and enrollment records, and handles exam registration. ' +
      'No access to scores.',
    isSystem: true,
    permissions: [
      { resource: 'students', actions: ['manage'] },
      { resource: 'guardians', actions: ['manage'] },
      { resource: 'enrollments', actions: ['manage'] },
      { resource: 'classrooms', actions: ['read', 'update'] },
      { resource: 'locations', actions: ['create', 'read', 'update'] },
      { resource: 'exams', actions: ['manage'] },
      { resource: 'certificates', actions: ['create', 'read'] },
      { resource: 'reports', actions: ['create', 'read', 'export'] },
      { resource: 'term-results', actions: ['read'] },
      { resource: 'attendances', actions: ['read'] },
      { resource: 'behavior-logs', actions: ['read'] },
      ...readOnly(
        'teachers',
        'school-years',
        'semesters',
        'grade-levels',
        'subject-groups',
        'subjects',
        'announcements',
        'notifications',
        'calendar',
        'documents',
      ),
    ],
  },

  {
    code: 'school_nurse',
    nameLo: 'ພະນັກງານສາທາລະນະສຸກໂຮງຮຽນ',
    nameEn: 'School Nurse',
    description:
      'Runs vaccination campaigns and holds the dose records. Reads the student register only ' +
      'as far as building a roll needs — no scores, no conduct, no attendance.',
    isSystem: true,
    permissions: [
      { resource: 'vaccinations', actions: ['manage'] },
      ...readOnly(
        'students',
        'guardians',
        'enrollments',
        'classrooms',
        'grade-levels',
        'school-years',
        'announcements',
        'notifications',
        'calendar',
      ),
    ],
  },

  {
    code: 'student',
    nameLo: 'ນັກຮຽນ',
    nameEn: 'Student',
    description:
      'Reads their own records. The `read` grants below are further narrowed per-request: a ' +
      'student sees only their own data, and only published term results.',
    isSystem: true,
    permissions: readOnly(
      'students',
      'scores',
      'conduct-scores',
      'attendances',
      'term-results',
      'exams',
      'certificates',
      'reports',
      'announcements',
      'notifications',
      'calendar',
      'documents',
      'subjects',
      'classrooms',
    ).concat([{ resource: 'feedback', actions: ['create'] }]),
  },

  {
    code: 'guardian',
    nameLo: 'ຜູ້ປົກຄອງ',
    nameEn: 'Guardian',
    description:
      "Reads the records of linked students, subject to each link's `canViewRecords` flag " +
      'and to term results having been published.',
    isSystem: true,
    permissions: readOnly(
      'students',
      'scores',
      'conduct-scores',
      'attendances',
      'term-results',
      'exams',
      'certificates',
      'reports',
      'announcements',
      'notifications',
      'calendar',
    ).concat([{ resource: 'feedback', actions: ['create'] }]),
  },
];
