import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ADMIN_USERNAME, TestContext, auth, createTestApp, login } from './test-app';

/**
 * Phase 1 + 2 academic operations end to end: enrollment capacity and
 * uniqueness, timetable conflicts, the score lock flow, and term-result
 * computation with ranking.
 */
describe('Academic operations (e2e)', () => {
  let context: TestContext;
  let app: INestApplication;
  let token: string;

  // Seeded ids, resolved in beforeAll.
  let schoolYearId: string;
  let semesterId: string;
  let gradeLevelId: string;
  let classroomId: string;
  let secondClassroomId: string;
  let mathSubjectId: string;
  let laoSubjectId: string;
  let teacherId: string;
  let otherTeacherId: string;
  let villageId: string;

  const http = () => request(app.getHttpServer());

  /**
   * Reads the guardian id from a student's embedded link.
   *
   * `GET /students/:id` populates `guardianId`, and the populated document is
   * serialized with `id` (not `_id`) by the schema transform — so the link is
   * either a plain id string or an object carrying `id`.
   */
  function guardianIdOf(student: { guardians: { guardianId: string | { id: string } }[] }): string {
    const link = student.guardians[0].guardianId;
    return typeof link === 'string' ? link : link.id;
  }

  /** Creates a student with one inline guardian and returns its id. */
  async function createStudent(code: string, firstNameLo: string): Promise<string> {
    const response = await http()
      .post('/api/students')
      .set(auth(token))
      .send({
        studentCode: code,
        firstNameLo,
        lastNameLo: 'ວົງສະຫວັນ',
        gender: 'female',
        dateOfBirth: '2010-05-14',
        villageId,
        guardians: [
          {
            guardian: {
              firstNameLo: 'ບຸນມີ',
              lastNameLo: 'ສີສຸວັນ',
              phone: '02055500001',
            },
            relationship: 'father',
            isPrimary: true,
          },
        ],
      })
      .expect(201);

    return response.body.id;
  }

  beforeAll(async () => {
    context = await createTestApp();
    app = context.app;

    // Clear the seeded forced-password-change so the admin can act.
    const initial = await login(app, ADMIN_USERNAME, 'ChangeMe123');
    await http()
      .post('/api/auth/change-password')
      .set(auth(initial.accessToken))
      .send({ currentPassword: 'ChangeMe123', newPassword: 'AdminPass456' })
      .expect(204);
    token = (await login(app, ADMIN_USERNAME, 'AdminPass456')).accessToken;

    const [year, semester, grades, subjects, teachers, locations] = await Promise.all([
      http().get('/api/school-years/active').set(auth(token)).expect(200),
      http().get('/api/semesters/active').set(auth(token)).expect(200),
      http().get('/api/grade-levels?limit=20').set(auth(token)).expect(200),
      http().get('/api/subjects?limit=100').set(auth(token)).expect(200),
      http().get('/api/teachers?limit=10').set(auth(token)).expect(200),
      http().get('/api/locations?type=village&limit=10').set(auth(token)).expect(200),
    ]);

    schoolYearId = year.body.id;
    semesterId = semester.body.id;
    villageId = locations.body.data[0].id;

    const m4 = grades.body.data.find((g: { code: string }) => g.code === 'm4');
    gradeLevelId = m4.id;

    mathSubjectId = subjects.body.data.find((s: { code: string }) => s.code === 'MATH-M4').id;
    laoSubjectId = subjects.body.data.find((s: { code: string }) => s.code === 'LAO-M4').id;

    teacherId = teachers.body.data[0].id;
    otherTeacherId = teachers.body.data[1].id;

    const classrooms = await http()
      .get(`/api/classrooms?schoolYearId=${schoolYearId}&gradeLevelId=${gradeLevelId}`)
      .set(auth(token))
      .expect(200);
    classroomId = classrooms.body.data[0].id;
    secondClassroomId = classrooms.body.data[1].id;
  }, 180_000);

  afterAll(async () => {
    await context?.close();
  });

  describe('locations tree', () => {
    it('returns the province → district → village hierarchy', async () => {
      const response = await http().get('/api/locations/tree').set(auth(token)).expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].type).toBe('province');
      expect(response.body[0].children[0].type).toBe('district');
      expect(response.body[0].children[0].children[0].type).toBe('village');
    });

    it('finds every village under a province via the ancestors index', async () => {
      const tree = await http().get('/api/locations/tree').set(auth(token)).expect(200);
      const provinceId = tree.body[0].id;

      const response = await http()
        .get(`/api/locations?ancestorId=${provinceId}&type=village&limit=50`)
        .set(auth(token))
        .expect(200);

      // Four villages across two districts, reached in one query.
      expect(response.body.meta.total).toBe(4);
    });

    it('rejects a village whose parent is a province rather than a district', async () => {
      const tree = await http().get('/api/locations/tree').set(auth(token)).expect(200);

      const response = await http()
        .post('/api/locations')
        .set(auth(token))
        .send({ nameLo: 'ບ້ານຜິດ', type: 'village', parentId: tree.body[0].id })
        .expect(400);

      expect(response.body.messageKey).toBe('location.invalidParentType');
    });
  });

  describe('students and guardians', () => {
    it('creates a student together with a new guardian in one transaction', async () => {
      const studentId = await createStudent('S-TX-001', 'ນາງ');

      const student = await http().get(`/api/students/${studentId}`).set(auth(token)).expect(200);

      expect(student.body.guardians).toHaveLength(1);
      expect(student.body.guardians[0].relationship).toBe('father');
      expect(student.body.guardians[0].isPrimary).toBe(true);
      // The denormalized copy is populated at creation time.
      expect(student.body.guardians[0].fullNameLo).toBe('ບຸນມີ ສີສຸວັນ');
    });

    it('requires at least one guardian', async () => {
      await http()
        .post('/api/students')
        .set(auth(token))
        .send({
          studentCode: 'S-NO-GUARDIAN',
          firstNameLo: 'ນາງ',
          lastNameLo: 'ວົງສະຫວັນ',
          gender: 'female',
          dateOfBirth: '2010-05-14',
          guardians: [],
        })
        .expect(400);
    });

    it('rejects a duplicate student code', async () => {
      await createStudent('S-DUP-001', 'ນາງ');

      const response = await http()
        .post('/api/students')
        .set(auth(token))
        .send({
          studentCode: 'S-DUP-001',
          firstNameLo: 'ອື່ນ',
          lastNameLo: 'ວົງສະຫວັນ',
          gender: 'male',
          dateOfBirth: '2010-01-01',
          guardians: [
            {
              guardian: { firstNameLo: 'ກ', lastNameLo: 'ຂ', phone: '02055500002' },
              relationship: 'mother',
              isPrimary: true,
            },
          ],
        })
        .expect(409);

      expect(response.body.messageKey).toBe('common.duplicate');
    });

    it('propagates a guardian phone change into the copies embedded on students', async () => {
      // This is the denormalization contract from docs/schema-design.md §3.1.
      const studentId = await createStudent('S-SYNC-001', 'ນາງ');

      const before = await http().get(`/api/students/${studentId}`).set(auth(token)).expect(200);
      const guardianId = guardianIdOf(before.body);

      await http()
        .patch(`/api/guardians/${guardianId}`)
        .set(auth(token))
        .send({ phone: '02099988877', firstNameLo: 'ບຸນມີໃໝ່' })
        .expect(200);

      const after = await http().get(`/api/students/${studentId}`).set(auth(token)).expect(200);
      expect(after.body.guardians[0].phone).toBe('02099988877');
      expect(after.body.guardians[0].fullNameLo).toBe('ບຸນມີໃໝ່ ສີສຸວັນ');
    });

    it('finds students by guardian', async () => {
      const studentId = await createStudent('S-BYGUARD-001', 'ນາງ');
      const student = await http().get(`/api/students/${studentId}`).set(auth(token)).expect(200);
      const guardianId = guardianIdOf(student.body);

      const children = await http()
        .get(`/api/guardians/${guardianId}/children`)
        .set(auth(token))
        .expect(200);

      expect(children.body).toHaveLength(1);
      expect(children.body[0].studentCode).toBe('S-BYGUARD-001');
    });

    it('searches students by Lao name', async () => {
      await createStudent('S-SEARCH-001', 'ສົມໃຈ');

      const response = await http().get('/api/students?search=ສົມໃຈ').set(auth(token)).expect(200);

      expect(response.body.meta.total).toBeGreaterThanOrEqual(1);
      expect(
        response.body.data.some((s: { studentCode: string }) => s.studentCode === 'S-SEARCH-001'),
      ).toBe(true);
    });

    /**
     * A list of students means the children currently attending, so the leavers
     * have to be asked for by name. Without this the school's whole history
     * accumulates in every roster, picker and headcount.
     */
    it('lists only the children currently attending unless another status is asked for', async () => {
      const studentId = await createStudent('S-STATUS-001', 'ຈົບ');
      await http()
        .patch(`/api/students/${studentId}`)
        .set(auth(token))
        .send({ status: 'graduated' })
        .expect(200);

      const codesOf = (body: { data: { studentCode: string }[] }) =>
        body.data.map((row) => row.studentCode);

      // Default: gone from the list.
      const byDefault = await http()
        .get('/api/students?limit=100&search=S-STATUS-001')
        .set(auth(token))
        .expect(200);
      expect(codesOf(byDefault.body)).not.toContain('S-STATUS-001');
      expect(byDefault.body.meta.total).toBe(0);

      // Named explicitly: found.
      const byStatus = await http()
        .get('/api/students?limit=100&search=S-STATUS-001&status=graduated')
        .set(auth(token))
        .expect(200);
      expect(codesOf(byStatus.body)).toContain('S-STATUS-001');

      // `all` is the escape hatch for the whole register.
      const everyone = await http()
        .get('/api/students?limit=100&search=S-STATUS-001&status=all')
        .set(auth(token))
        .expect(200);
      expect(codesOf(everyone.body)).toContain('S-STATUS-001');
    });

    /**
     * The `active` default is scoped to browsing. A child who has left is still
     * on file: reachable by id, and still their siblings' sibling — which is the
     * whole reason the office asks.
     */
    it('leaves a departed student on file, by id and in a sibling list', async () => {
      const stayingId = await createStudent('S-STATUS-002', 'ຢູ່');
      const staying = await http().get(`/api/students/${stayingId}`).set(auth(token)).expect(200);
      const guardianId = guardianIdOf(staying.body);

      // The departed sibling shares that guardian, which is what links them.
      const leaverId = await http()
        .post('/api/students')
        .set(auth(token))
        .send({
          studentCode: 'S-STATUS-003',
          firstNameLo: 'ຍ້າຍ',
          lastNameLo: 'ວົງສະຫວັນ',
          gender: 'male',
          dateOfBirth: '2008-02-02',
          guardians: [{ guardianId, relationship: 'father', isPrimary: true }],
        })
        .expect(201)
        .then((response) => response.body.id as string);

      await http()
        .patch(`/api/students/${leaverId}`)
        .set(auth(token))
        .send({ status: 'transferred' })
        .expect(200);

      // Gone from the roster…
      const roster = await http()
        .get('/api/students?limit=100&search=S-STATUS-003')
        .set(auth(token))
        .expect(200);
      expect(roster.body.meta.total).toBe(0);

      // …but still readable by id…
      await http().get(`/api/students/${leaverId}`).set(auth(token)).expect(200);

      // …and still a sibling.
      const siblings = await http()
        .get(`/api/students/${stayingId}/siblings`)
        .set(auth(token))
        .expect(200);
      expect(siblings.body.map((row: { studentCode: string }) => row.studentCode)).toContain(
        'S-STATUS-003',
      );

      // The guardian's own children list keeps them too — a family record, not a roll.
      const children = await http()
        .get(`/api/guardians/${guardianId}/children`)
        .set(auth(token))
        .expect(200);
      expect(children.body.map((row: { studentCode: string }) => row.studentCode)).toContain(
        'S-STATUS-003',
      );
    });
  });

  describe('enrollment', () => {
    it('enrolls a student and increments the classroom headcount', async () => {
      const studentId = await createStudent('S-ENR-001', 'ນາງ');

      const before = await http()
        .get(`/api/classrooms/${classroomId}`)
        .set(auth(token))
        .expect(200);

      const enrollment = await http()
        .post('/api/enrollments')
        .set(auth(token))
        .send({ studentId, classroomId })
        .expect(201);

      expect(enrollment.body.status).toBe('active');
      expect(enrollment.body.rollNumber).toBe(before.body.currentCount + 1);

      const after = await http().get(`/api/classrooms/${classroomId}`).set(auth(token)).expect(200);
      expect(after.body.currentCount).toBe(before.body.currentCount + 1);
    });

    it('refuses a second enrollment in the same school year', async () => {
      const studentId = await createStudent('S-ENR-002', 'ນາງ');

      await http()
        .post('/api/enrollments')
        .set(auth(token))
        .send({ studentId, classroomId })
        .expect(201);

      const response = await http()
        .post('/api/enrollments')
        .set(auth(token))
        .send({ studentId, classroomId: secondClassroomId })
        .expect(409);

      expect(response.body.messageKey).toBe('enrollment.alreadyEnrolled');
    });

    it('rejects an unknown student id', async () => {
      await http()
        .post('/api/enrollments')
        .set(auth(token))
        .send({ studentId: '507f1f77bcf86cd799439099', classroomId })
        .expect(400);
    });

    it('moves a student between classrooms, adjusting both headcounts', async () => {
      const studentId = await createStudent('S-XFER-001', 'ນາງ');
      const enrollment = await http()
        .post('/api/enrollments')
        .set(auth(token))
        .send({ studentId, classroomId })
        .expect(201);

      const originBefore = await http()
        .get(`/api/classrooms/${classroomId}`)
        .set(auth(token))
        .expect(200);
      const destinationBefore = await http()
        .get(`/api/classrooms/${secondClassroomId}`)
        .set(auth(token))
        .expect(200);

      await http()
        .patch(`/api/enrollments/${enrollment.body.id}/status`)
        .set(auth(token))
        .send({
          status: 'transferred',
          transferredToClassroomId: secondClassroomId,
          reason: 'family moved district',
        })
        .expect(200);

      const originAfter = await http()
        .get(`/api/classrooms/${classroomId}`)
        .set(auth(token))
        .expect(200);
      const destinationAfter = await http()
        .get(`/api/classrooms/${secondClassroomId}`)
        .set(auth(token))
        .expect(200);

      expect(originAfter.body.currentCount).toBe(originBefore.body.currentCount - 1);
      expect(destinationAfter.body.currentCount).toBe(destinationBefore.body.currentCount + 1);
    });

    it('refuses an illegal status transition', async () => {
      const studentId = await createStudent('S-STATUS-001', 'ນາງ');
      const enrollment = await http()
        .post('/api/enrollments')
        .set(auth(token))
        .send({ studentId, classroomId })
        .expect(201);

      await http()
        .patch(`/api/enrollments/${enrollment.body.id}/status`)
        .set(auth(token))
        .send({ status: 'promoted' })
        .expect(200);

      // `promoted` is terminal.
      const response = await http()
        .patch(`/api/enrollments/${enrollment.body.id}/status`)
        .set(auth(token))
        .send({ status: 'dropped' })
        .expect(400);

      expect(response.body.messageKey).toBe('enrollment.invalidStatusTransition');
    });

    it('reports per-row outcomes from a bulk enroll', async () => {
      await createStudent('S-BULK-001', 'ນາງ');
      await createStudent('S-BULK-002', 'ນາງ');

      const response = await http()
        .post('/api/enrollments/bulk')
        .set(auth(token))
        .send({
          items: [
            { studentCode: 'S-BULK-001', classroomId },
            { studentCode: 'S-BULK-002', classroomId },
            { studentCode: 'S-DOES-NOT-EXIST', classroomId },
          ],
        })
        .expect(201);

      // The bad row fails without discarding the good ones.
      expect(response.body.enrolled).toBe(2);
      expect(response.body.failed).toBe(1);
      expect(response.body.errors[0].studentCode).toBe('S-DOES-NOT-EXIST');
    });

    it('enforces classroom capacity', async () => {
      // A one-seat classroom makes the limit reachable in a test.
      const tiny = await http()
        .post('/api/classrooms')
        .set(auth(token))
        .send({ schoolYearId, gradeLevelId, name: 'ຄັບແຄບ', capacity: 1 })
        .expect(201);

      const first = await createStudent('S-CAP-001', 'ນາງ');
      const second = await createStudent('S-CAP-002', 'ນາງ');

      await http()
        .post('/api/enrollments')
        .set(auth(token))
        .send({ studentId: first, classroomId: tiny.body.id })
        .expect(201);

      const response = await http()
        .post('/api/enrollments')
        .set(auth(token))
        .send({ studentId: second, classroomId: tiny.body.id })
        .expect(409);

      expect(response.body.messageKey).toBe('classroom.capacityExceeded');
    });
  });

  describe('teaching assignments', () => {
    it('creates an assignment with a schedule', async () => {
      const response = await http()
        .post('/api/teaching-assignments')
        .set(auth(token))
        .send({
          teacherId,
          subjectId: mathSubjectId,
          classroomId,
          semesterId,
          schedule: [{ dayOfWeek: 1, startTime: '15:10', endTime: '16:00', room: 'R101' }],
        })
        .expect(201);

      expect(response.body.schedule).toHaveLength(1);
    });

    it('names the grade level and the department on the subject list', async () => {
      // Both are refs. Left unresolved the list renders "—" for the grade and
      // "not yet assigned to a department" for the group on *every* row, however
      // carefully each subject was filed — which is indistinguishable from the
      // school never having filed them.
      const response = await http().get('/api/subjects?limit=100').set(auth(token)).expect(200);
      const math = response.body.data.find((s: { code: string }) => s.code === 'MATH-M4');

      expect(math.gradeLevelId).toMatchObject({ code: 'm4' });
      expect(typeof math.subjectGroupId).toBe('object');
      expect(math.subjectGroupId.nameLo).toBeTruthy();
    });

    /** The reported bug: the department was filed, and the list kept saying it was not. */
    it('shows a department on the list the moment it is assigned', async () => {
      const groups = await http().get('/api/subject-groups?limit=100').set(auth(token)).expect(200);
      const group = groups.body.data[0] as { id: string; nameLo: string };
      expect(group).toBeDefined();

      // Its own subject, so nothing else in the file depends on how it is filed.
      const subjectId = await http()
        .post('/api/subjects')
        .set(auth(token))
        .send({ code: 'GRP-TEST', nameLo: 'ວິຊາທົດລອງ', gradeLevelId: gradeLevelId })
        .expect(201)
        .then((response) => response.body.id as string);

      const rowFor = async () => {
        const list = await http()
          .get('/api/subjects?limit=100&search=GRP-TEST')
          .set(auth(token))
          .expect(200);
        return list.body.data.find((s: { code: string }) => s.code === 'GRP-TEST') as {
          subjectGroupId: { id: string; nameLo: string } | null;
        };
      };

      // Unfiled to start with, which is what the list should say.
      expect((await rowFor()).subjectGroupId).toBeNull();

      await http()
        .patch(`/api/subjects/${subjectId}`)
        .set(auth(token))
        .send({ subjectGroupId: group.id })
        .expect(200);

      const filed = await rowFor();
      expect(filed.subjectGroupId).toMatchObject({ id: group.id, nameLo: group.nameLo });

      // And back off again, so the column is not simply always populated.
      await http()
        .patch(`/api/subjects/${subjectId}`)
        .set(auth(token))
        .send({ subjectGroupId: null })
        .expect(200);
      expect((await rowFor()).subjectGroupId).toBeNull();
    });

    it('rejects a teacher double-booked at the same time', async () => {
      const response = await http()
        .post('/api/teaching-assignments')
        .set(auth(token))
        .send({
          teacherId,
          subjectId: laoSubjectId,
          classroomId: secondClassroomId,
          semesterId,
          schedule: [{ dayOfWeek: 1, startTime: '15:40', endTime: '16:30', room: 'R202' }],
        })
        .expect(409);

      expect(response.body.messageKey).toBe('assignment.teacherConflict');
      expect(response.body.details.conflicts.length).toBeGreaterThan(0);
    });

    it('rejects a classroom double-booked at the same time', async () => {
      const response = await http()
        .post('/api/teaching-assignments')
        .set(auth(token))
        .send({
          teacherId: otherTeacherId,
          subjectId: laoSubjectId,
          classroomId,
          semesterId,
          schedule: [{ dayOfWeek: 1, startTime: '15:10', endTime: '16:00', room: 'R303' }],
        })
        .expect(409);

      expect(response.body.messageKey).toBe('assignment.classroomConflict');
    });

    it('allows a back-to-back period for the same teacher', async () => {
      await http()
        .post('/api/teaching-assignments')
        .set(auth(token))
        .send({
          teacherId,
          subjectId: laoSubjectId,
          classroomId,
          semesterId,
          schedule: [{ dayOfWeek: 1, startTime: '16:00', endTime: '16:50', room: 'R101' }],
        })
        .expect(201);
    });

    it('rejects a schedule that overlaps itself', async () => {
      await http()
        .post('/api/teaching-assignments')
        .set(auth(token))
        .send({
          teacherId: otherTeacherId,
          subjectId: mathSubjectId,
          classroomId: secondClassroomId,
          semesterId,
          schedule: [
            { dayOfWeek: 3, startTime: '15:10', endTime: '16:10' },
            { dayOfWeek: 3, startTime: '15:40', endTime: '16:40' },
          ],
        })
        .expect(400);
    });

    it('rejects a subject from a different grade level', async () => {
      const subjects = await http().get('/api/subjects?limit=100').set(auth(token)).expect(200);
      const m1Math = subjects.body.data.find((s: { code: string }) => s.code === 'MATH-M1');

      const response = await http()
        .post('/api/teaching-assignments')
        .set(auth(token))
        .send({
          teacherId: otherTeacherId,
          subjectId: m1Math.id,
          classroomId,
          semesterId,
          schedule: [{ dayOfWeek: 5, startTime: '14:00', endTime: '15:00' }],
        })
        .expect(400);

      expect(response.body.messageKey).toBe('assignment.subjectGradeMismatch');
    });

    it('rejects an inverted time range', async () => {
      await http()
        .post('/api/teaching-assignments')
        .set(auth(token))
        .send({
          teacherId: otherTeacherId,
          subjectId: mathSubjectId,
          classroomId: secondClassroomId,
          semesterId,
          schedule: [{ dayOfWeek: 4, startTime: '10:00', endTime: '09:00' }],
        })
        .expect(400);
    });
  });

  describe('score components', () => {
    it('reports the running weight total', async () => {
      const response = await http()
        .get(
          `/api/score-components/weight-summary?subjectId=${mathSubjectId}` +
            `&semesterId=${semesterId}&classroomId=${classroomId}`,
        )
        .set(auth(token))
        .expect(200);

      expect(response.body.totalWeight).toBe(0);
      expect(response.body.isValid).toBe(false);
    });

    it('refuses a component that would push the total past 100', async () => {
      const created = await http()
        .post('/api/score-components')
        .set(auth(token))
        .send({
          subjectId: laoSubjectId,
          semesterId,
          classroomId,
          nameLo: 'ສອບເສັງໃຫຍ່',
          type: 'final',
          weight: 90,
          maxScore: 100,
        })
        .expect(201);

      expect(created.body.weight).toBe(90);

      const response = await http()
        .post('/api/score-components')
        .set(auth(token))
        .send({
          subjectId: laoSubjectId,
          semesterId,
          classroomId,
          nameLo: 'ເກີນ',
          type: 'quiz',
          weight: 20,
          maxScore: 20,
        })
        .expect(422);

      expect(response.body.messageKey).toBe('score.weightSumInvalid');
    });
  });

  describe('scores, locking, and term results', () => {
    let midtermId: string;
    let finalId: string;
    const studentIds: string[] = [];

    beforeAll(async () => {
      // Two components totalling 100 so the term result is computable.
      const midterm = await http()
        .post('/api/score-components')
        .set(auth(token))
        .send({
          subjectId: mathSubjectId,
          semesterId,
          classroomId,
          nameLo: 'ສອບເສັງກາງພາກ',
          type: 'midterm',
          weight: 40,
          maxScore: 40,
          displayOrder: 1,
        })
        .expect(201);
      midtermId = midterm.body.id;

      const final = await http()
        .post('/api/score-components')
        .set(auth(token))
        .send({
          subjectId: mathSubjectId,
          semesterId,
          classroomId,
          nameLo: 'ສອບເສັງທ້າຍພາກ',
          type: 'final',
          weight: 60,
          maxScore: 60,
          displayOrder: 2,
        })
        .expect(201);
      finalId = final.body.id;

      // Three students with distinct marks, so ranking is observable.
      for (const [index, code] of ['S-SC-001', 'S-SC-002', 'S-SC-003'].entries()) {
        const studentId = await createStudent(code, `ນັກຮຽນ${index + 1}`);
        await http()
          .post('/api/enrollments')
          .set(auth(token))
          .send({ studentId, classroomId })
          .expect(201);
        studentIds.push(studentId);
      }
    }, 60_000);

    it('confirms the weights now total 100', async () => {
      const response = await http()
        .get(
          `/api/score-components/weight-summary?subjectId=${mathSubjectId}` +
            `&semesterId=${semesterId}&classroomId=${classroomId}`,
        )
        .set(auth(token))
        .expect(200);

      expect(response.body.totalWeight).toBe(100);
      expect(response.body.isValid).toBe(true);
    });

    it('lists the whole roster in the entry grid, including ungraded students', async () => {
      const response = await http()
        .get(`/api/scores/entry-grid?componentId=${midtermId}&classroomId=${classroomId}`)
        .set(auth(token))
        .expect(200);

      expect(response.body.component.maxScore).toBe(40);
      expect(response.body.entries.length).toBeGreaterThanOrEqual(3);
      expect(response.body.entries.every((e: { score: null }) => e.score === null)).toBe(true);
    });

    it('saves a batch of marks', async () => {
      const response = await http()
        .post('/api/scores/batch')
        .set(auth(token))
        .send({
          componentId: midtermId,
          classroomId,
          entries: [
            { studentId: studentIds[0], score: 36 },
            { studentId: studentIds[1], score: 30 },
            { studentId: studentIds[2], score: 24 },
          ],
        })
        .expect(201);

      expect(response.body.saved).toBe(3);
      expect(response.body.skipped).toBe(0);
    });

    it('rejects a mark above the component maximum', async () => {
      const response = await http()
        .post('/api/scores/batch')
        .set(auth(token))
        .send({
          componentId: midtermId,
          classroomId,
          entries: [{ studentId: studentIds[0], score: 41 }],
        })
        .expect(201);

      // Per-entry failure, reported rather than thrown, so one bad mark does not
      // discard the batch.
      expect(response.body.saved).toBe(0);
      expect(response.body.skipped).toBe(1);
      expect(response.body.errors[0].reason).toBe('score.exceedsMax');
    });

    it('rejects a student who is not in the classroom', async () => {
      const outsider = await createStudent('S-OUTSIDE-001', 'ນອກ');

      const response = await http()
        .post('/api/scores/batch')
        .set(auth(token))
        .send({
          componentId: midtermId,
          classroomId,
          entries: [{ studentId: outsider, score: 20 }],
        })
        .expect(201);

      expect(response.body.errors[0].reason).toBe('score.studentNotInClassroom');
    });

    it('computes a provisional result while a component is still ungraded', async () => {
      const response = await http()
        .post('/api/term-results/compute-sync')
        .set(auth(token))
        .send({ classroomId, semesterId })
        .expect(201);

      expect(response.body.studentsProcessed).toBeGreaterThanOrEqual(3);
      // The final exam has no marks yet, so every result is provisional.
      expect(response.body.provisionalCount).toBeGreaterThanOrEqual(3);
    });

    it('withholds provisional results from publication', async () => {
      const response = await http()
        .post('/api/term-results/publish')
        .set(auth(token))
        .send({ classroomId, semesterId })
        .expect(200);

      expect(response.body.published).toBe(0);
      expect(response.body.withheld).toBeGreaterThanOrEqual(3);
    });

    it('locks scores and then refuses an amendment without a reason', async () => {
      await http()
        .post('/api/scores/lock')
        .set(auth(token))
        .send({ componentId: midtermId, classroomId })
        .expect(200);

      const response = await http()
        .post('/api/scores/batch')
        .set(auth(token))
        .send({
          componentId: midtermId,
          classroomId,
          entries: [{ studentId: studentIds[0], score: 38 }],
        })
        .expect(409);

      expect(response.body.messageKey).toBe('score.overrideReasonRequired');
    });

    it('accepts a locked-score amendment with a reason and audits it', async () => {
      await http()
        .post('/api/scores/batch')
        .set(auth(token))
        .send({
          componentId: midtermId,
          classroomId,
          entries: [{ studentId: studentIds[0], score: 38 }],
          overrideReason: 'Marking error found during moderation review',
        })
        .expect(201);

      const audit = await http()
        .get('/api/audit-logs?entityType=scores&action=update&limit=10')
        .set(auth(token))
        .expect(200);

      const amendment = audit.body.data.find((entry: { reason: string | null }) =>
        entry.reason?.startsWith('POST-LOCK AMENDMENT'),
      );
      expect(amendment).toBeDefined();
      expect(amendment.reason).toContain('Marking error found');
    });

    it('rejects an unlock reason shorter than the minimum', async () => {
      await http()
        .post('/api/scores/unlock')
        .set(auth(token))
        .send({ componentId: midtermId, classroomId, reason: 'oops' })
        .expect(400);
    });

    it('unlocks with a proper reason', async () => {
      const response = await http()
        .post('/api/scores/unlock')
        .set(auth(token))
        .send({
          componentId: midtermId,
          classroomId,
          reason: 'Moderation committee approved a re-mark of the cohort',
        })
        .expect(200);

      expect(response.body.unlocked).toBeGreaterThan(0);
    });

    it('computes complete results and ranks the class once all marks are in', async () => {
      await http()
        .post('/api/scores/batch')
        .set(auth(token))
        .send({
          componentId: finalId,
          classroomId,
          entries: [
            { studentId: studentIds[0], score: 54 },
            { studentId: studentIds[1], score: 45 },
            { studentId: studentIds[2], score: 36 },
          ],
        })
        .expect(201);

      const computed = await http()
        .post('/api/term-results/compute-sync')
        .set(auth(token))
        .send({ classroomId, semesterId })
        .expect(201);

      expect(computed.body.provisionalCount).toBe(0);

      const ranking = await http()
        .get(`/api/term-results/ranking/classroom/${classroomId}/semester/${semesterId}`)
        .set(auth(token))
        .expect(200);

      const ranked = ranking.body.filter((r: { rank: number | null }) => r.rank !== null);
      expect(ranked.length).toBeGreaterThanOrEqual(3);

      // 38/40 → 95% of a 40 weight, 54/60 → 90% of a 60 weight ⇒ 38 + 54 = 92.
      const top = ranked.find((r: { studentId: string }) => r.studentId === studentIds[0]);
      expect(top.rank).toBe(1);
      expect(top.average).toBe(92);

      // Ranks are strictly ordered for distinct averages.
      const second = ranked.find((r: { studentId: string }) => r.studentId === studentIds[1]);
      const third = ranked.find((r: { studentId: string }) => r.studentId === studentIds[2]);
      expect(second.rank).toBe(2);
      expect(third.rank).toBe(3);
      expect(second.average).toBeGreaterThan(third.average);
    });

    it('publishes complete results', async () => {
      const response = await http()
        .post('/api/term-results/publish')
        .set(auth(token))
        .send({ classroomId, semesterId })
        .expect(200);

      expect(response.body.published).toBeGreaterThanOrEqual(3);
      expect(response.body.withheld).toBe(0);
    });
  });

  describe('attendance', () => {
    let attendanceStudentId: string;

    beforeAll(async () => {
      attendanceStudentId = await createStudent('S-ATT-001', 'ນາງ');
      await http()
        .post('/api/enrollments')
        .set(auth(token))
        .send({ studentId: attendanceStudentId, classroomId })
        .expect(201);
    });

    /**
     * Teachers know a child by what the class calls them, so every register the
     * two logging screens draw carries the nickname next to the register name.
     * It is joined off the student rather than read from the enrollment snapshot,
     * which is taken at placement and so predates most nicknames.
     */
    it('names students on the roll-call sheet by their nickname too', async () => {
      const nicknamedId = await http()
        .post('/api/students')
        .set(auth(token))
        .send({
          studentCode: 'S-NICK-001',
          firstNameLo: 'ສົມຈິດ',
          lastNameLo: 'ວົງສາ',
          gender: 'female',
          dateOfBirth: '2011-06-06',
          guardians: [
            {
              guardian: { firstNameLo: 'ບຸນມີ', lastNameLo: 'ວົງສາ', phone: '02055500123' },
              relationship: 'father',
              isPrimary: true,
            },
          ],
        })
        .expect(201)
        .then((response) => response.body.id as string);

      await http()
        .post('/api/enrollments')
        .set(auth(token))
        .send({ studentId: nicknamedId, classroomId })
        .expect(201);

      // Typed in *after* placement, which is the case a denormalized copy misses.
      await http()
        .patch(`/api/students/${nicknamedId}`)
        .set(auth(token))
        .send({ nickname: 'ລິຕ້າ' })
        .expect(200);

      // The sheet is built from the timetable, so this test brings its own lesson
      // rather than leaning on one another test happens to have created. Tuesday
      // is untouched by the rest of the file, and the time sits inside the seeded
      // school day (15:10–16:55) — Monday is already booked end to end.
      await http()
        .post('/api/teaching-assignments')
        .set(auth(token))
        .send({
          // A pairing no other test claims: one assignment per
          // teacher+subject+classroom is all the timetable allows.
          teacherId: otherTeacherId,
          subjectId: laoSubjectId,
          classroomId,
          semesterId,
          schedule: [{ dayOfWeek: 2, startTime: '15:10', endTime: '16:00', room: 'R100' }],
        })
        .expect(201);

      // 2025-09-16 is a Tuesday, which is when that lesson falls.
      const sheet = await http()
        .get(`/api/attendances/daily-sheet?classroomId=${classroomId}&date=2025-09-16`)
        .set(auth(token))
        .expect(200);

      const entries = sheet.body.lessons.flatMap(
        (lesson: { entries: { studentId: string; studentNickname: string | null }[] }) =>
          lesson.entries,
      );
      const entry = entries.find((row: { studentId: string }) => row.studentId === nicknamedId) as
        { studentNickname: string | null } | undefined;

      expect(entry?.studentNickname).toBe('ລິຕ້າ');
      // A child with none on file gets `null`, not the register name repeated.
      expect(
        entries.some(
          (row: { studentId: string; studentNickname: string | null }) =>
            row.studentId === attendanceStudentId && row.studentNickname === null,
        ),
      ).toBe(true);

      // The class roster the attendance summary is built from carries it as well.
      const roster = await http()
        .get(`/api/enrollments/classroom/${classroomId}/roster`)
        .set(auth(token))
        .expect(200);
      const rosterRow = roster.body.find(
        (row: { studentCode: string }) => row.studentCode === 'S-NICK-001',
      ) as { studentId: { nickname?: string } } | undefined;
      expect(rosterRow?.studentId.nickname).toBe('ລິຕ້າ');
    });

    it('records a roll call', async () => {
      const response = await http()
        .post('/api/attendances')
        .set(auth(token))
        .send({
          classroomId,
          semesterId,
          date: '2025-09-15',
          entries: [{ studentId: attendanceStudentId, status: 'present' }],
        })
        .expect(200);

      expect(response.body.recorded).toBe(1);
    });

    it('is idempotent — a corrected roll call updates rather than duplicates', async () => {
      await http()
        .post('/api/attendances')
        .set(auth(token))
        .send({
          classroomId,
          semesterId,
          date: '2025-09-15',
          entries: [{ studentId: attendanceStudentId, status: 'late', minutesLate: 15 }],
        })
        .expect(200);

      const records = await http()
        .get(`/api/attendances?studentId=${attendanceStudentId}&from=2025-09-15&to=2025-09-15`)
        .set(auth(token))
        .expect(200);

      expect(records.body.meta.total).toBe(1);
      expect(records.body.data[0].status).toBe('late');
      expect(records.body.data[0].minutesLate).toBe(15);
    });

    it('rejects a future date', async () => {
      const response = await http()
        .post('/api/attendances')
        .set(auth(token))
        .send({
          classroomId,
          semesterId,
          date: '2099-01-01',
          entries: [{ studentId: attendanceStudentId, status: 'present' }],
        })
        .expect(400);

      expect(response.body.messageKey).toBe('attendance.futureDate');
    });

    it('rejects a date outside the semester', async () => {
      const response = await http()
        .post('/api/attendances')
        .set(auth(token))
        .send({
          classroomId,
          semesterId,
          date: '2024-01-15',
          entries: [{ studentId: attendanceStudentId, status: 'present' }],
        })
        .expect(400);

      expect(response.body.messageKey).toBe('attendance.outsideSemester');
    });

    it('summarizes attendance with a rate', async () => {
      await http()
        .post('/api/attendances')
        .set(auth(token))
        .send({
          classroomId,
          semesterId,
          date: '2025-09-16',
          entries: [{ studentId: attendanceStudentId, status: 'absent' }],
        })
        .expect(200);

      const summary = await http()
        .get(`/api/attendances/summary/student/${attendanceStudentId}/semester/${semesterId}`)
        .set(auth(token))
        .expect(200);

      expect(summary.body.late).toBe(1);
      expect(summary.body.absent).toBe(1);
      expect(summary.body.totalRecorded).toBe(2);
      // One late (counts as attended) out of two records.
      expect(summary.body.attendanceRate).toBe(50);
    });
  });

  describe('conduct scores', () => {
    it('derives the letter grade from the numeric score', async () => {
      const studentId = await createStudent('S-CON-001', 'ນາງ');
      await http()
        .post('/api/enrollments')
        .set(auth(token))
        .send({ studentId, classroomId })
        .expect(201);

      const response = await http()
        .put('/api/conduct-scores')
        .set(auth(token))
        .send({
          studentId,
          semesterId,
          classroomId,
          periodType: 'semester',
          periodValue: 1,
          score: 92,
        })
        .expect(200);

      expect(response.body.grade).toBe('excellent');
    });

    it('replaces rather than duplicates a score for the same period', async () => {
      const studentId = await createStudent('S-CON-002', 'ນາງ');
      await http()
        .post('/api/enrollments')
        .set(auth(token))
        .send({ studentId, classroomId })
        .expect(201);

      const payload = {
        studentId,
        semesterId,
        classroomId,
        periodType: 'monthly' as const,
        periodValue: 9,
      };

      await http()
        .put('/api/conduct-scores')
        .set(auth(token))
        .send({ ...payload, score: 70 })
        .expect(200);
      await http()
        .put('/api/conduct-scores')
        .set(auth(token))
        .send({ ...payload, score: 85 })
        .expect(200);

      const records = await http()
        .get(`/api/conduct-scores?studentId=${studentId}&semesterId=${semesterId}`)
        .set(auth(token))
        .expect(200);

      expect(records.body.meta.total).toBe(1);
      expect(records.body.data[0].score).toBe(85);
      expect(records.body.data[0].grade).toBe('very_good');
    });
  });

  describe('pagination', () => {
    it('reports pagination metadata', async () => {
      const response = await http()
        .get('/api/students?page=1&limit=2')
        .set(auth(token))
        .expect(200);

      expect(response.body.data.length).toBeLessThanOrEqual(2);
      expect(response.body.meta).toMatchObject({ page: 1, limit: 2 });
      expect(response.body.meta.totalPages).toEqual(expect.any(Number));
    });

    it('caps the page size', async () => {
      await http().get('/api/students?limit=5000').set(auth(token)).expect(400);
    });

    it('ignores a sort field that is not whitelisted', async () => {
      // An arbitrary field would force an unindexed scan, so it falls back to
      // the default sort rather than erroring.
      await http().get('/api/students?sortBy=notARealField').set(auth(token)).expect(200);
    });
  });
});
