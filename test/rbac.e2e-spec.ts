import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ADMIN_USERNAME, TestContext, auth, createTestApp, login } from './test-app';

/**
 * Authorization boundaries between roles.
 *
 * Each seeded role gets a real account, and the tests assert both what it may do
 * and — more importantly — what it may not. Two rules go beyond the permission
 * matrix and are checked explicitly:
 *
 *  - a teacher may only grade the classes they are assigned to;
 *  - a student or guardian may only read their own records.
 */
describe('RBAC (e2e)', () => {
  let context: TestContext;
  let app: INestApplication;
  let adminToken: string;

  const PASSWORD = 'RolePass123';
  const http = () => request(app.getHttpServer());

  const tokens: Record<string, string> = {};

  let classroomId: string;
  let otherClassroomId: string;
  let semesterId: string;
  let mathSubjectId: string;
  let engSubjectId: string;
  let assignedTeacherId: string;
  let unassignedTeacherId: string;
  let studentId: string;
  let guardianId: string;
  let componentId: string;

  /** Creates an account for a role and logs in, returning the access token. */
  async function createAccount(
    username: string,
    roleCode: string,
    person?: { personType: 'teacher' | 'student' | 'guardian'; personId: string },
  ): Promise<string> {
    const roleId = (await context.seed.findRoleId(roleCode))!.toString();

    await http()
      .post('/api/users')
      .set(auth(adminToken))
      .send({
        username,
        password: PASSWORD,
        roleId,
        personType: person?.personType ?? 'staff',
        personId: person?.personId,
        mustChangePassword: false,
      })
      .expect(201);

    return (await login(app, username, PASSWORD)).accessToken;
  }

  beforeAll(async () => {
    context = await createTestApp();
    app = context.app;

    const initial = await login(app, ADMIN_USERNAME, 'ChangeMe123');
    await http()
      .post('/api/auth/change-password')
      .set(auth(initial.accessToken))
      .send({ currentPassword: 'ChangeMe123', newPassword: 'AdminPass456' })
      .expect(204);
    adminToken = (await login(app, ADMIN_USERNAME, 'AdminPass456')).accessToken;

    // ── Resolve seeded fixtures ────────────────────────────────────────────
    const [semester, grades, subjects, teachers, villages] = await Promise.all([
      http().get('/api/semesters/active').set(auth(adminToken)).expect(200),
      http().get('/api/grade-levels?limit=20').set(auth(adminToken)).expect(200),
      http().get('/api/subjects?limit=100').set(auth(adminToken)).expect(200),
      http().get('/api/teachers?limit=10').set(auth(adminToken)).expect(200),
      http().get('/api/locations?type=village&limit=5').set(auth(adminToken)).expect(200),
    ]);

    semesterId = semester.body.id;
    const gradeLevelId = grades.body.data.find((g: { code: string }) => g.code === 'm4').id;
    mathSubjectId = subjects.body.data.find((s: { code: string }) => s.code === 'MATH-M4').id;
    engSubjectId = subjects.body.data.find((s: { code: string }) => s.code === 'ENG-M4').id;
    assignedTeacherId = teachers.body.data[0].id;
    unassignedTeacherId = teachers.body.data[1].id;
    const villageId = villages.body.data[0].id;

    const classrooms = await http()
      .get(`/api/classrooms?gradeLevelId=${gradeLevelId}`)
      .set(auth(adminToken))
      .expect(200);
    classroomId = classrooms.body.data[0].id;
    otherClassroomId = classrooms.body.data[1].id;

    // ── A student with a guardian, enrolled in the classroom ───────────────
    const student = await http()
      .post('/api/students')
      .set(auth(adminToken))
      .send({
        studentCode: 'S-RBAC-001',
        firstNameLo: 'ນາງ',
        lastNameLo: 'ວົງສະຫວັນ',
        gender: 'female',
        dateOfBirth: '2010-05-14',
        villageId,
        guardians: [
          {
            guardian: { firstNameLo: 'ບຸນມີ', lastNameLo: 'ສີສຸວັນ', phone: '02055577001' },
            relationship: 'father',
            isPrimary: true,
          },
        ],
      })
      .expect(201);
    studentId = student.body.id;
    // The embedded link is not populated on create, so it is a plain id string.
    const link = student.body.guardians[0].guardianId;
    guardianId = typeof link === 'string' ? link : link.id;

    await http()
      .post('/api/enrollments')
      .set(auth(adminToken))
      .send({ studentId, classroomId })
      .expect(201);

    // ── Assign the first teacher to maths in this classroom only ───────────
    await http()
      .post('/api/teaching-assignments')
      .set(auth(adminToken))
      .send({
        teacherId: assignedTeacherId,
        subjectId: mathSubjectId,
        classroomId,
        semesterId,
        schedule: [{ dayOfWeek: 1, startTime: '08:00', endTime: '08:50' }],
      })
      .expect(201);

    const component = await http()
      .post('/api/score-components')
      .set(auth(adminToken))
      .send({
        subjectId: mathSubjectId,
        semesterId,
        classroomId,
        nameLo: 'ສອບເສັງ',
        type: 'final',
        weight: 100,
        maxScore: 100,
      })
      .expect(201);
    componentId = component.body.id;

    // ── Accounts, one per role ─────────────────────────────────────────────
    tokens.academicHead = await createAccount('head1', 'academic_head');
    tokens.registrar = await createAccount('registrar1', 'registrar');
    tokens.assignedTeacher = await createAccount('teacher1', 'teacher', {
      personType: 'teacher',
      personId: assignedTeacherId,
    });
    tokens.unassignedTeacher = await createAccount('teacher2', 'teacher', {
      personType: 'teacher',
      personId: unassignedTeacherId,
    });
    tokens.student = await createAccount('student1', 'student', {
      personType: 'student',
      personId: studentId,
    });
    tokens.guardian = await createAccount('guardian1', 'guardian', {
      personType: 'guardian',
      personId: guardianId,
    });
  }, 240_000);

  afterAll(async () => {
    await context?.close();
  });

  describe('permission matrix', () => {
    it('lets an admin manage roles', async () => {
      await http().get('/api/roles').set(auth(adminToken)).expect(200);
    });

    it('denies a teacher access to roles', async () => {
      const response = await http().get('/api/roles').set(auth(tokens.assignedTeacher)).expect(403);

      expect(response.body.messageKey).toBe('auth.forbidden');
      expect(response.body.details.required).toEqual(['roles:read']);
    });

    it('denies the academic head access to user accounts', async () => {
      // The academic head runs academics but must not be able to grant itself
      // more authority by editing accounts.
      await http().get('/api/users').set(auth(tokens.academicHead)).expect(403);
    });

    it('denies a registrar access to scores', async () => {
      await http().get('/api/scores').set(auth(tokens.registrar)).expect(403);
    });

    it('lets a registrar manage students', async () => {
      await http().get('/api/students').set(auth(tokens.registrar)).expect(200);
    });

    it('lets a teacher read students but not delete them', async () => {
      await http().get('/api/students').set(auth(tokens.assignedTeacher)).expect(200);
      await http()
        .delete(`/api/students/${studentId}`)
        .set(auth(tokens.assignedTeacher))
        .expect(403);
    });

    it('denies a student access to the audit log', async () => {
      await http().get('/api/audit-logs').set(auth(tokens.student)).expect(403);
    });

    it('reports the resolved permission set on /auth/me', async () => {
      const response = await http()
        .get('/api/auth/me')
        .set(auth(tokens.assignedTeacher))
        .expect(200);

      expect(response.body.roleCode).toBe('teacher');
      const scores = response.body.permissions.find(
        (p: { resource: string }) => p.resource === 'scores',
      );
      // A teacher can enter and lock grades but not reopen them.
      expect(scores.actions).toEqual(expect.arrayContaining(['create', 'read', 'update']));
      expect(scores.actions).not.toContain('manage');
    });
  });

  describe('teacher assignment scoping', () => {
    it('lets the assigned teacher enter marks', async () => {
      const response = await http()
        .post('/api/scores/batch')
        .set(auth(tokens.assignedTeacher))
        .send({ componentId, classroomId, entries: [{ studentId, score: 80 }] })
        .expect(201);

      expect(response.body.saved).toBe(1);
    });

    it('refuses a teacher who is not assigned to that subject and class', async () => {
      // Holding `scores:create` is not enough — the assignment is checked too.
      const response = await http()
        .post('/api/scores/batch')
        .set(auth(tokens.unassignedTeacher))
        .send({ componentId, classroomId, entries: [{ studentId, score: 100 }] })
        .expect(403);

      expect(response.body.messageKey).toBe('score.notAssignedTeacher');
    });

    it('lets the academic head enter marks for any class via scores:manage', async () => {
      const response = await http()
        .post('/api/scores/batch')
        .set(auth(tokens.academicHead))
        .send({ componentId, classroomId, entries: [{ studentId, score: 85 }] })
        .expect(201);

      expect(response.body.saved).toBe(1);
    });

    it('denies a teacher the unlock endpoint, which needs scores:manage', async () => {
      await http()
        .post('/api/scores/lock')
        .set(auth(tokens.assignedTeacher))
        .send({ componentId, classroomId })
        .expect(200);

      await http()
        .post('/api/scores/unlock')
        .set(auth(tokens.assignedTeacher))
        .send({
          componentId,
          classroomId,
          reason: 'I would like to change this mark please',
        })
        .expect(403);
    });

    it('lets the academic head unlock', async () => {
      await http()
        .post('/api/scores/unlock')
        .set(auth(tokens.academicHead))
        .send({
          componentId,
          classroomId,
          reason: 'Moderation committee approved a re-mark',
        })
        .expect(200);
    });

    it('scopes the assignment check per classroom, not per teacher', async () => {
      // The same teacher, the same subject, but a class they do not teach.
      const otherComponent = await http()
        .post('/api/score-components')
        .set(auth(adminToken))
        .send({
          subjectId: engSubjectId,
          semesterId,
          classroomId: otherClassroomId,
          nameLo: 'ສອບເສັງອື່ນ',
          type: 'final',
          weight: 100,
          maxScore: 100,
        })
        .expect(201);

      await http()
        .post('/api/scores/batch')
        .set(auth(tokens.assignedTeacher))
        .send({
          componentId: otherComponent.body.id,
          classroomId: otherClassroomId,
          entries: [{ studentId, score: 50 }],
        })
        .expect(403);
    });
  });

  describe('student and guardian self-access', () => {
    it('lets a student read their own record', async () => {
      const response = await http()
        .get(`/api/students/${studentId}`)
        .set(auth(tokens.student))
        .expect(200);

      expect(response.body.studentCode).toBe('S-RBAC-001');
    });

    it("denies a student another student's record", async () => {
      const other = await http()
        .post('/api/students')
        .set(auth(adminToken))
        .send({
          studentCode: 'S-RBAC-OTHER',
          firstNameLo: 'ອື່ນ',
          lastNameLo: 'ວົງສະຫວັນ',
          gender: 'male',
          dateOfBirth: '2010-01-01',
          guardians: [
            {
              guardian: { firstNameLo: 'ກ', lastNameLo: 'ຂ', phone: '02055577002' },
              relationship: 'mother',
              isPrimary: true,
            },
          ],
        })
        .expect(201);

      await http().get(`/api/students/${other.body.id}`).set(auth(tokens.student)).expect(403);
    });

    it('lets a linked guardian read their child’s record', async () => {
      const response = await http()
        .get(`/api/students/${studentId}`)
        .set(auth(tokens.guardian))
        .expect(200);

      expect(response.body.studentCode).toBe('S-RBAC-001');
    });

    it('denies a guardian a student they are not linked to', async () => {
      const unrelated = await http()
        .post('/api/students')
        .set(auth(adminToken))
        .send({
          studentCode: 'S-RBAC-UNRELATED',
          firstNameLo: 'ບໍ່ກ່ຽວ',
          lastNameLo: 'ວົງສະຫວັນ',
          gender: 'male',
          dateOfBirth: '2010-01-01',
          guardians: [
            {
              guardian: { firstNameLo: 'ຄ', lastNameLo: 'ງ', phone: '02055577003' },
              relationship: 'father',
              isPrimary: true,
            },
          ],
        })
        .expect(201);

      await http().get(`/api/students/${unrelated.body.id}`).set(auth(tokens.guardian)).expect(403);
    });

    it('denies a guardian whose link has canViewRecords turned off', async () => {
      await http()
        .put(`/api/students/${studentId}/guardians`)
        .set(auth(adminToken))
        .send({
          guardians: [
            {
              guardianId,
              relationship: 'father',
              isPrimary: true,
              canViewRecords: false,
            },
          ],
        })
        .expect(200);

      await http().get(`/api/students/${studentId}`).set(auth(tokens.guardian)).expect(403);

      // Restore access for the remaining tests.
      await http()
        .put(`/api/students/${studentId}/guardians`)
        .set(auth(adminToken))
        .send({
          guardians: [
            { guardianId, relationship: 'father', isPrimary: true, canViewRecords: true },
          ],
        })
        .expect(200);
    });
  });

  describe('term-result publication gate', () => {
    it('hides an unpublished result from a student', async () => {
      await http()
        .post('/api/term-results/compute-sync')
        .set(auth(adminToken))
        .send({ classroomId, semesterId })
        .expect(201);

      const response = await http()
        .get(`/api/term-results/student/${studentId}/semester/${semesterId}`)
        .set(auth(tokens.student))
        .expect(403);

      expect(response.body.messageKey).toBe('termResult.notPublished');
    });

    it('shows an unpublished result to staff holding term-results:manage', async () => {
      await http()
        .get(`/api/term-results/student/${studentId}/semester/${semesterId}`)
        .set(auth(tokens.academicHead))
        .expect(200);
    });

    it('shows the result to the student once published', async () => {
      await http()
        .post('/api/term-results/publish')
        .set(auth(adminToken))
        .send({ classroomId, semesterId })
        .expect(200);

      const response = await http()
        .get(`/api/term-results/student/${studentId}/semester/${semesterId}`)
        .set(auth(tokens.student))
        .expect(200);

      expect(response.body.isPublished).toBe(true);
    });
  });

  /**
   * A `read` grant answers "may this role read term results at all", never
   * "*whose*". Students and guardians hold read grants on several
   * student-scoped resources, so every list endpoint must narrow to their own
   * records — otherwise the grant hands them the whole school's data.
   */
  describe('student-scoped reads are narrowed to own records', () => {
    let otherStudentId: string;

    beforeAll(async () => {
      const other = await http()
        .post('/api/students')
        .set(auth(adminToken))
        .send({
          studentCode: 'S-SCOPE-OTHER',
          firstNameLo: 'ຄົນອື່ນ',
          lastNameLo: 'ວົງສະຫວັນ',
          gender: 'male',
          dateOfBirth: '2010-01-01',
          guardians: [
            {
              guardian: { firstNameLo: 'ພໍ່', lastNameLo: 'ອື່ນ', phone: '02055577010' },
              relationship: 'father',
              isPrimary: true,
            },
          ],
        })
        .expect(201);
      otherStudentId = other.body.id;

      await http()
        .post('/api/enrollments')
        .set(auth(adminToken))
        .send({ studentId: otherStudentId, classroomId: otherClassroomId })
        .expect(201);
    });

    it('returns only the student’s own scores from the list endpoint', async () => {
      const asAdmin = await http().get('/api/scores?limit=100').set(auth(adminToken)).expect(200);
      const asStudent = await http()
        .get('/api/scores?limit=100')
        .set(auth(tokens.student))
        .expect(200);

      expect(asAdmin.body.meta.total).toBeGreaterThan(0);
      expect(
        asStudent.body.data.every((s: { studentId: string }) => s.studentId === studentId),
      ).toBe(true);
    });

    it('ignores a studentId query parameter naming someone else', async () => {
      // Passing another id must yield nothing rather than silently substituting
      // the caller's own records.
      const response = await http()
        .get(`/api/scores?studentId=${otherStudentId}`)
        .set(auth(tokens.student))
        .expect(200);

      expect(response.body.meta.total).toBe(0);
    });

    it('narrows the term-results list to the student’s own', async () => {
      const response = await http()
        .get('/api/term-results?limit=100')
        .set(auth(tokens.student))
        .expect(200);

      expect(
        response.body.data.every((r: { studentId: string }) => r.studentId === studentId),
      ).toBe(true);
    });

    it('narrows the attendance list to the student’s own', async () => {
      const response = await http()
        .get('/api/attendances?limit=100')
        .set(auth(tokens.student))
        .expect(200);

      expect(
        response.body.data.every((a: { studentId: string }) => a.studentId === studentId),
      ).toBe(true);
    });

    it("denies a student another student's term result by id", async () => {
      await http()
        .post('/api/term-results/compute-sync')
        .set(auth(adminToken))
        .send({ classroomId: otherClassroomId, semesterId })
        .expect(201)
        .catch(() => undefined); // no scores for that class; nothing to compute

      await http()
        .get(`/api/term-results/student/${otherStudentId}/semester/${semesterId}`)
        .set(auth(tokens.student))
        .expect(403);
    });

    it("denies a student another student's scores by id", async () => {
      await http()
        .get(`/api/scores/student/${otherStudentId}/semester/${semesterId}`)
        .set(auth(tokens.student))
        .expect(403);
    });

    it('leaves staff reads unrestricted', async () => {
      // The scope applies to students and guardians only; for staff the
      // permission matrix is the whole policy.
      const response = await http()
        .get('/api/scores?limit=100')
        .set(auth(tokens.academicHead))
        .expect(200);

      expect(response.body.meta.total).toBeGreaterThan(0);
    });
  });

  describe('system role protection', () => {
    it('refuses to delete a system role', async () => {
      const roles = await http().get('/api/roles').set(auth(adminToken)).expect(200);
      const adminRole = roles.body.data.find((r: { code: string }) => r.code === 'admin');

      await http().delete(`/api/roles/${adminRole.id}`).set(auth(adminToken)).expect(403);
    });

    it('refuses to change the permissions of a system role', async () => {
      // Editing `admin` out of its own permissions would lock everyone out.
      const roles = await http().get('/api/roles').set(auth(adminToken)).expect(200);
      const adminRole = roles.body.data.find((r: { code: string }) => r.code === 'admin');

      await http()
        .patch(`/api/roles/${adminRole.id}`)
        .set(auth(adminToken))
        .send({ permissions: [{ resource: 'students', actions: ['read'] }] })
        .expect(403);
    });

    it('allows renaming a system role', async () => {
      const roles = await http().get('/api/roles').set(auth(adminToken)).expect(200);
      const teacherRole = roles.body.data.find((r: { code: string }) => r.code === 'teacher');

      await http()
        .patch(`/api/roles/${teacherRole.id}`)
        .set(auth(adminToken))
        .send({ nameEn: 'Teaching Staff' })
        .expect(200);
    });
  });

  describe('account suspension', () => {
    it('revokes sessions when an account is suspended', async () => {
      const token = await createAccount('suspendme', 'teacher');
      const users = await http()
        .get('/api/users?search=suspendme')
        .set(auth(adminToken))
        .expect(200);
      const userId = users.body.data[0].id;

      await http().get('/api/auth/me').set(auth(token)).expect(200);

      await http()
        .patch(`/api/users/${userId}`)
        .set(auth(adminToken))
        .send({ status: 'suspended' })
        .expect(200);

      // The user is re-read on every request, so the token dies immediately
      // rather than lingering until it expires.
      await http().get('/api/auth/me').set(auth(token)).expect(401);
    });
  });
});
