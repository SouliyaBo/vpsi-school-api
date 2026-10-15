import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  ADMIN_USERNAME,
  TestContext,
  auth,
  createTestApp,
  login,
  markEveryGradeSubject,
} from './test-app';

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
  let gradeLevelId: string;
  let semesterId: string;
  let mathSubjectId: string;
  let engSubjectId: string;
  let assignedTeacherId: string;
  let unassignedTeacherId: string;
  let studentId: string;
  let guardianId: string;
  let componentId: string;
  /** The Monday maths lesson the assigned teacher owns — what cover is claimed on. */
  let mathLessonId: string;

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
    gradeLevelId = grades.body.data.find((g: { code: string }) => g.code === 'm4').id;
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

    // Homeroom teachers, set explicitly: the seed hands them out round-robin, and
    // the students list scope turns on which room each teacher owns.
    await http()
      .patch(`/api/classrooms/${classroomId}`)
      .set(auth(adminToken))
      .send({ homeroomTeacherId: assignedTeacherId })
      .expect(200);
    await http()
      .patch(`/api/classrooms/${otherClassroomId}`)
      .set(auth(adminToken))
      .send({ homeroomTeacherId: unassignedTeacherId })
      .expect(200);

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
    const mathLesson = await http()
      .post('/api/teaching-assignments')
      .set(auth(adminToken))
      .send({
        teacherId: assignedTeacherId,
        subjectId: mathSubjectId,
        classroomId,
        semesterId,
        // Inside the seeded school day (`schedule.dayStartTime`/`dayEndTime`),
        // which this school runs in the afternoon.
        schedule: [{ dayOfWeek: 1, startTime: '15:10', endTime: '16:00' }],
      })
      .expect(201);
    mathLessonId = mathLesson.body.id;

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

  /**
   * ການມອບໝາຍສອນແທນ — cover for a colleague's lesson.
   *
   * The gap this closes: the teacher standing in front of the class was not the
   * teacher on the timetable, so they could not mark the roll or write the
   * behaviour register, and the office was keying both in from a paper note. A
   * claim admits them to those two and to nothing else.
   *
   * MONDAY is 2025-09-15, inside the seeded term and comfortably past — which is
   * also why the office files the first claim: a teacher's own claim window shuts
   * at the lesson's paperwork deadline, and that is the rule being tested here.
   */
  describe('lesson cover', () => {
    const MONDAY = '2025-09-15';
    const TUESDAY = '2025-09-16';
    let claimId: string;

    const rollCall = (token: string, date = MONDAY) =>
      http()
        .post('/api/attendances')
        .set(auth(token))
        .send({
          teachingAssignmentId: mathLessonId,
          date,
          entries: [{ studentId, status: 'present' }],
        });

    it('refuses the roll call to a teacher who does not hold the lesson', async () => {
      const response = await rollCall(tokens.unassignedTeacher).expect(403);

      expect(response.body.messageKey).toBe('attendance.notAssignedTeacher');
    });

    it('shuts a teacher’s own claim window at the lesson’s paperwork deadline', async () => {
      // Self-service does not mean open-ended: a claim on a lesson whose register
      // was due weeks ago would move a gap off one teacher's row and onto
      // another's long after either of them could have filled it.
      const response = await http()
        .post('/api/lesson-substitutions')
        .set(auth(tokens.unassignedTeacher))
        .send({ teachingAssignmentId: mathLessonId, date: MONDAY, reason: 'ລາປ່ວຍ' })
        .expect(400);

      expect(response.body.messageKey).toBe('substitution.claimWindowClosed');
    });

    it('lets the office file that cover, which the deadline does not bind', async () => {
      const response = await http()
        .post('/api/lesson-substitutions')
        .set(auth(tokens.academicHead))
        .send({
          teachingAssignmentId: mathLessonId,
          date: MONDAY,
          substituteTeacherId: unassignedTeacherId,
          reason: 'ລາປ່ວຍ',
        })
        .expect(201);

      claimId = response.body.id;
      expect(response.body.ownerTeacherId).toBe(assignedTeacherId);
    });

    it('now lets the stand-in mark that day’s roll, stamped as cover', async () => {
      await rollCall(tokens.unassignedTeacher).expect(200);

      const records = await http()
        .get(`/api/attendances?studentId=${studentId}&from=${MONDAY}&to=${MONDAY}`)
        .set(auth(adminToken))
        .expect(200);

      // `teacherId` stays the timetabled teacher — every per-subject figure is
      // built on it — and the stand-in is named beside them. Both come back
      // populated, because the log is read as "who, on what day".
      expect(records.body.data[0].teacherId.id).toBe(assignedTeacherId);
      expect(records.body.data[0].substituteTeacherId.id).toBe(unassignedTeacherId);
    });

    it('still refuses the stand-in the marks for that subject', async () => {
      // The guard that matters most. A day's cover is not a term's grades, and
      // scores are checked against the assignment rather than the day.
      const response = await http()
        .post('/api/scores/batch')
        .set(auth(tokens.unassignedTeacher))
        .send({ componentId, classroomId, entries: [{ studentId, score: 99 }] })
        .expect(403);

      expect(response.body.messageKey).toBe('score.notAssignedTeacher');
    });

    it('refuses a second claim on the same lesson-day', async () => {
      // Two teachers who each believe they covered the period are told about each
      // other rather than one quietly replacing the other.
      const response = await http()
        .post('/api/lesson-substitutions')
        .set(auth(tokens.academicHead))
        .send({
          teachingAssignmentId: mathLessonId,
          date: MONDAY,
          substituteTeacherId: unassignedTeacherId,
        })
        .expect(409);

      expect(response.body.messageKey).toBe('substitution.alreadyClaimed');
    });

    it('refuses cover for a day the lesson is not taught on', async () => {
      const response = await http()
        .post('/api/lesson-substitutions')
        .set(auth(tokens.academicHead))
        .send({
          teachingAssignmentId: mathLessonId,
          date: TUESDAY,
          substituteTeacherId: unassignedTeacherId,
        })
        .expect(400);

      expect(response.body.messageKey).toBe('attendance.lessonNotScheduled');
    });

    it('shows the claim to both teachers and to nobody else', async () => {
      for (const token of [tokens.assignedTeacher, tokens.unassignedTeacher]) {
        const response = await http().get('/api/lesson-substitutions').set(auth(token)).expect(200);
        expect(response.body.meta.total).toBe(1);
      }

      // A student holds no grant on it at all.
      await http().get('/api/lesson-substitutions').set(auth(tokens.student)).expect(403);
    });

    it('refuses the timetabled teacher the withdrawal of somebody else’s claim', async () => {
      const response = await http()
        .delete(`/api/lesson-substitutions/${claimId}`)
        .set(auth(tokens.assignedTeacher))
        .expect(403);

      expect(response.body.messageKey).toBe('substitution.notYours');
    });

    it('lets the stand-in withdraw their own, which closes the lesson to them again', async () => {
      await http()
        .delete(`/api/lesson-substitutions/${claimId}`)
        .set(auth(tokens.unassignedTeacher))
        .expect(204);

      const response = await rollCall(tokens.unassignedTeacher).expect(403);
      expect(response.body.messageKey).toBe('attendance.notAssignedTeacher');
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

  describe('homeroom scope on the students list', () => {
    it('shows a homeroom teacher only the children in their own classroom', async () => {
      const response = await http()
        .get('/api/students?limit=100')
        .set(auth(tokens.assignedTeacher))
        .expect(200);

      const codes = response.body.data.map((row: { studentCode: string }) => row.studentCode);
      expect(codes).toContain('S-RBAC-001');
      // Every row is placed in the classroom this teacher is homeroom teacher of.
      for (const row of response.body.data) {
        expect(row.currentEnrollment?.classroomId).toBe(classroomId);
      }
    });

    it('shows nothing to a teacher whose homeroom is empty', async () => {
      const response = await http()
        .get('/api/students?limit=100')
        .set(auth(tokens.unassignedTeacher))
        .expect(200);

      expect(response.body.meta.total).toBe(0);
      expect(response.body.data).toEqual([]);
    });

    it('denies a teacher a student outside their homeroom by id', async () => {
      await http()
        .get(`/api/students/${studentId}`)
        .set(auth(tokens.unassignedTeacher))
        .expect(403);

      await http().get(`/api/students/${studentId}`).set(auth(tokens.assignedTeacher)).expect(200);
    });

    it('lets a homeroom teacher correct their own student', async () => {
      const response = await http()
        .patch(`/api/students/${studentId}`)
        .set(auth(tokens.assignedTeacher))
        .send({ phone: '02055512399', nickname: 'ນ້ອຍ' })
        .expect(200);

      expect(response.body.phone).toBe('02055512399');
      expect(response.body.nickname).toBe('ນ້ອຍ');
    });

    it('denies a teacher a student outside their homeroom', async () => {
      const response = await http()
        .patch(`/api/students/${studentId}`)
        .set(auth(tokens.unassignedTeacher))
        .send({ nickname: 'ບໍ່ຄວນໄດ້' })
        .expect(403);

      expect(response.body.messageKey).toBe('student.notInHomeroom');
    });

    it('refuses a status change from a homeroom teacher', async () => {
      const response = await http()
        .patch(`/api/students/${studentId}`)
        .set(auth(tokens.assignedTeacher))
        .send({ status: 'dropped' })
        .expect(403);

      expect(response.body.messageKey).toBe('student.statusIsOfficeOnly');
    });

    it('lets an unchanged status through, because the edit form posts it back', async () => {
      await http()
        .patch(`/api/students/${studentId}`)
        .set(auth(tokens.assignedTeacher))
        .send({ status: 'active', contactName: 'ພໍ່ບຸນມີ' })
        .expect(200);
    });

    it('still lets the office change a status, dating a suspension and clearing it on return', async () => {
      const suspended = await http()
        .patch(`/api/students/${studentId}`)
        .set(auth(tokens.registrar))
        .send({ status: 'suspended', suspendedAt: '2026-09-15' })
        .expect(200);
      expect(suspended.body.suspendedAt).toBe('2026-09-15T00:00:00.000Z');
      expect(suspended.body.statusBeforeSuspension).toBe('active');

      // The date is part of the office's decision, not the homeroom teacher's.
      const refused = await http()
        .patch(`/api/students/${studentId}`)
        .set(auth(tokens.assignedTeacher))
        .send({ suspendedAt: '2026-10-01' })
        .expect(403);
      expect(refused.body.messageKey).toBe('student.statusIsOfficeOnly');

      const back = await http()
        .patch(`/api/students/${studentId}`)
        .set(auth(tokens.registrar))
        .send({ status: 'active' })
        .expect(200);
      expect(back.body.suspendedAt).toBeNull();
      expect(back.body.statusBeforeSuspension).toBeNull();
    });

    it('refuses a code change from a homeroom teacher', async () => {
      const response = await http()
        .patch(`/api/students/${studentId}`)
        .set(auth(tokens.assignedTeacher))
        .send({ studentCode: 'S-RBAC-STOLEN' })
        .expect(403);

      expect(response.body.messageKey).toBe('student.codeIsOfficeOnly');
    });

    it('lets an unchanged code through, because the edit form posts it back', async () => {
      const current = await http()
        .get(`/api/students/${studentId}`)
        .set(auth(tokens.assignedTeacher))
        .expect(200);

      await http()
        .patch(`/api/students/${studentId}`)
        .set(auth(tokens.assignedTeacher))
        .send({ studentCode: current.body.studentCode, nickname: 'ນ້ອຍນ້ອຍ' })
        .expect(200);
    });

    it('lets the office reissue a code and re-syncs the copies of it', async () => {
      const before = await http()
        .get(`/api/students/${studentId}`)
        .set(auth(tokens.registrar))
        .expect(200);

      const reissued = await http()
        .patch(`/api/students/${studentId}`)
        .set(auth(tokens.registrar))
        .send({ studentCode: 'S-RBAC-REISSUED' })
        .expect(200);

      expect(reissued.body.studentCode).toBe('S-RBAC-REISSUED');

      // The roster reads its own denormalized copy, so this is what proves the
      // new number actually reached the class list rather than only the register.
      const roster = await http()
        .get(`/api/enrollments?studentId=${studentId}&limit=100`)
        .set(auth(tokens.registrar))
        .expect(200);

      expect(roster.body.data.length).toBeGreaterThan(0);
      for (const enrollment of roster.body.data) {
        expect(enrollment.studentCode).toBe('S-RBAC-REISSUED');
      }

      await http()
        .patch(`/api/students/${studentId}`)
        .set(auth(tokens.registrar))
        .send({ studentCode: before.body.studentCode })
        .expect(200);
    });

    it('lets a homeroom teacher add a student and place them in their own room', async () => {
      const created = await http()
        .post('/api/students')
        .set(auth(tokens.assignedTeacher))
        .send({
          studentCode: 'S-RBAC-NEW',
          firstNameLo: 'ນ້ອງ',
          lastNameLo: 'ໃໝ່',
          gender: 'male',
          dateOfBirth: '2011-02-02',
          guardians: [
            {
              guardian: { firstNameLo: 'ພໍ່', lastNameLo: 'ໃໝ່', phone: '02055577010' },
              relationship: 'father',
              isPrimary: true,
            },
          ],
        })
        .expect(201);

      await http()
        .post('/api/enrollments')
        .set(auth(tokens.assignedTeacher))
        .send({ studentId: created.body.id, classroomId })
        .expect(201);

      // The point of the placement: the child they just added is now theirs to see.
      const list = await http()
        .get('/api/students?limit=100')
        .set(auth(tokens.assignedTeacher))
        .expect(200);

      expect(list.body.data.map((row: { studentCode: string }) => row.studentCode)).toContain(
        'S-RBAC-NEW',
      );
    });

    it('refuses to enter a newcomer as anything but a newcomer', async () => {
      const response = await http()
        .post('/api/students')
        .set(auth(tokens.assignedTeacher))
        .send({
          studentCode: 'S-RBAC-GRAD',
          firstNameLo: 'ຈົບ',
          lastNameLo: 'ແລ້ວ',
          gender: 'male',
          dateOfBirth: '2011-04-04',
          status: 'graduated',
          guardians: [
            {
              guardian: { firstNameLo: 'ພໍ່', lastNameLo: 'ຈົບ', phone: '02055577012' },
              relationship: 'father',
              isPrimary: true,
            },
          ],
        })
        .expect(403);

      expect(response.body.messageKey).toBe('student.statusIsOfficeOnly');
    });

    it('refuses to place a student in someone else’s room', async () => {
      const created = await http()
        .post('/api/students')
        .set(auth(tokens.assignedTeacher))
        .send({
          studentCode: 'S-RBAC-ELSEWHERE',
          firstNameLo: 'ຫ້ອງ',
          lastNameLo: 'ອື່ນ',
          gender: 'female',
          dateOfBirth: '2011-03-03',
          guardians: [
            {
              guardian: { firstNameLo: 'ແມ່', lastNameLo: 'ອື່ນ', phone: '02055577011' },
              relationship: 'mother',
              isPrimary: true,
            },
          ],
        })
        .expect(201);

      const response = await http()
        .post('/api/enrollments')
        .set(auth(tokens.assignedTeacher))
        .send({ studentId: created.body.id, classroomId: otherClassroomId })
        .expect(403);

      expect(response.body.messageKey).toBe('enrollment.notOwnHomeroom');
    });

    it('leaves the academic office unscoped', async () => {
      // `academic_head` holds more than `read` on students, so it looks across the
      // whole school even when its account is linked to a teacher with a homeroom.
      const response = await http()
        .get('/api/students?limit=100')
        .set(auth(tokens.academicHead))
        .expect(200);

      expect(response.body.meta.total).toBeGreaterThan(0);
    });
  });

  /**
   * ການຕິດຕາມນັກຮຽນຂອງຄູປະຈຳຫ້ອງ — the two-sided gate.
   *
   * The review is the one place where a teacher writes a record *about their own
   * oversight*, so both halves have to hold: a teacher may confirm their own room
   * and nobody else's, and the report that names who has not reviewed is the
   * office's rather than a colleague's.
   */
  describe('homeroom review scoping', () => {
    it('denies a teacher the compliance report, which needs `manage`', async () => {
      const response = await http()
        .get('/api/homeroom-reviews/compliance')
        .set(auth(tokens.assignedTeacher))
        .expect(403);

      expect(response.body.details.required).toEqual(['homeroom-reviews:manage']);
    });

    it('lets the academic head read it', async () => {
      const response = await http()
        .get('/api/homeroom-reviews/compliance')
        .set(auth(tokens.academicHead))
        .expect(200);

      // Starts from the rooms, so the fixture's classrooms are rows whether or not
      // anything has been filed against them.
      expect(Array.isArray(response.body.rows)).toBe(true);
      expect(response.body.summary.classrooms).toBeGreaterThan(0);
    });

    it('gives a homeroom teacher their own room, and the office none', async () => {
      const mine = await http()
        .get('/api/homeroom-reviews/mine')
        .set(auth(tokens.assignedTeacher))
        .expect(200);

      expect(mine.body.map((row: { classroom: { id: string } }) => row.classroom.id)).toEqual([
        classroomId,
      ]);

      // An office account is nobody's homeroom teacher: an empty list rather than
      // the school's.
      const office = await http()
        .get('/api/homeroom-reviews/mine')
        .set(auth(adminToken))
        .expect(200);

      expect(office.body).toEqual([]);
    });

    it('refuses a teacher the sheet for a room that is not theirs', async () => {
      const response = await http()
        .get(`/api/homeroom-reviews/sheet?classroomId=${otherClassroomId}`)
        .set(auth(tokens.assignedTeacher))
        .expect(403);

      expect(response.body.messageKey).toBe('homeroomReview.notHomeroomTeacher');
    });

    it('refuses a confirmation for a room that is not theirs', async () => {
      const response = await http()
        .post('/api/homeroom-reviews')
        .set(auth(tokens.assignedTeacher))
        .send({ classroomId: otherClassroomId, students: [] })
        .expect(403);

      expect(response.body.messageKey).toBe('homeroomReview.notHomeroomTeacher');
    });

    it('denies a student the review entirely', async () => {
      await http()
        .get(`/api/homeroom-reviews/sheet?classroomId=${classroomId}`)
        .set(auth(tokens.student))
        .expect(403);
    });

    it('refuses a date that is not a review day', async () => {
      // A Sunday, whichever week the fixture's term falls in.
      const response = await http()
        .get(`/api/homeroom-reviews/sheet?classroomId=${classroomId}&dueDate=2026-09-27`)
        .set(auth(tokens.assignedTeacher))
        .expect(400);

      expect(response.body.messageKey).toBe('homeroomReview.notReviewDay');
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
      // Publication refuses a provisional result, and the average divides by the
      // subjects the grade sits — so the whole curriculum has to be marked before
      // there is anything to publish. This spec is about the gate, not the marks.
      await markEveryGradeSubject(app, adminToken, {
        gradeLevelId,
        semesterId,
        classroomId,
        studentIds: [studentId],
      });
      await http()
        .post('/api/term-results/compute-sync')
        .set(auth(adminToken))
        .send({ classroomId, semesterId })
        .expect(201);

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

      // `studentId` comes back populated, and until the cover tests above filed a
      // roll call this suite held no attendance at all — so an `every` over an
      // empty list passed without asserting anything. Both are fixed here.
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(
        response.body.data.every(
          (a: { studentId: { id: string } }) => a.studentId.id === studentId,
        ),
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
