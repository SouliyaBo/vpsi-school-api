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
      'Runs academic operations: curriculum, assignments, grading oversight, and lesson-plan ' +
      'approval. Cannot manage user accounts or roles.',
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
      'and submits lesson plans. Score and behaviour entry are additionally restricted to the ' +
      'subjects and classrooms they are assigned to — the permission alone is not sufficient.',
    isSystem: true,
    permissions: [
      { resource: 'students', actions: ['read'] },
      { resource: 'guardians', actions: ['read'] },
      { resource: 'teachers', actions: ['read'] },
      { resource: 'classrooms', actions: ['read'] },
      { resource: 'subject-groups', actions: ['read'] },
      { resource: 'subjects', actions: ['read'] },
      { resource: 'teaching-assignments', actions: ['read'] },
      { resource: 'enrollments', actions: ['read'] },
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
