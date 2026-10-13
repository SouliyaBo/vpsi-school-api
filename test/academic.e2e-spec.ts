import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { flattenOfficialLocations } from 'src/database/locations/location-matching';
import {
  ADMIN_USERNAME,
  TestContext,
  auth,
  createTestApp,
  login,
  markEveryGradeSubject,
} from './test-app';

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

  /**
   * A reference id, whether the read populated it or left it bare.
   *
   * Reads differ on this — a list may populate what a detail read does not — so an
   * assertion about *which* record is pointed at should not also depend on which.
   */
  function refId(ref: unknown): string | null {
    if (!ref) return null;
    if (typeof ref === 'string') return ref;
    return (ref as { id?: string }).id ?? null;
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

      expect(response.body).toHaveLength(18);

      // Villages hang off the capital's districts — the official list has them
      // for Vientiane Capital only, so that is where all three levels appear.
      const capital = response.body.find(
        (province: { nameLo: string }) => province.nameLo === 'ນະຄອນຫຼວງວຽງຈັນ',
      );
      expect(capital.type).toBe('province');
      expect(capital.children).toHaveLength(9);
      expect(capital.children[0].type).toBe('district');
      expect(capital.children[0].children[0].type).toBe('village');
    });

    it('finds every village under a province via the ancestors index', async () => {
      const tree = await http().get('/api/locations/tree').set(auth(token)).expect(200);
      const capital = tree.body.find(
        (province: { nameLo: string }) => province.nameLo === 'ນະຄອນຫຼວງວຽງຈັນ',
      );

      const response = await http()
        .get(`/api/locations?ancestorId=${capital.id}&type=village&limit=50`)
        .set(auth(token))
        .expect(200);

      // Every village of the capital, across nine districts, in one query.
      const expected = flattenOfficialLocations().filter(
        (row) => row.type === 'village' && row.parentCode?.startsWith('01'),
      ).length;
      expect(response.body.meta.total).toBe(expected);
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

    /**
     * `ຫ້ອງພາກອັງກິດ` — set at placement, edited later, and carried through a move.
     *
     * It lives on the enrollment rather than the student because the English
     * lessons regroup the year every school year; these cover the three ways it
     * is written, including the one that clears it.
     */
    it('keeps the English-programme room on the placement, and lets it be edited', async () => {
      const studentId = await createStudent('S-ENGCLASS-001', 'ນາງ');

      const enrollment = await http()
        .post('/api/enrollments')
        .set(auth(token))
        .send({ studentId, classroomId, englishClass: 'EP-A' })
        .expect(201);

      expect(enrollment.body.englishClass).toBe('EP-A');

      const edited = await http()
        .patch(`/api/enrollments/${enrollment.body.id}`)
        .set(auth(token))
        .send({ englishClass: 'EP-B' })
        .expect(200);

      expect(edited.body.englishClass).toBe('EP-B');

      // An empty string is how the office takes a child out of the programme;
      // it has to reach `null` rather than be ignored as a blank.
      const cleared = await http()
        .patch(`/api/enrollments/${enrollment.body.id}`)
        .set(auth(token))
        .send({ englishClass: '' })
        .expect(200);

      expect(cleared.body.englishClass).toBeNull();
    });

    it('carries the English-programme room across a transfer', async () => {
      const studentId = await createStudent('S-ENGCLASS-002', 'ນາງ');
      const enrollment = await http()
        .post('/api/enrollments')
        .set(auth(token))
        .send({ studentId, classroomId, englishClass: 'EP-A' })
        .expect(201);

      await http()
        .patch(`/api/enrollments/${enrollment.body.id}/status`)
        .set(auth(token))
        .send({ status: 'transferred', transferredToClassroomId: secondClassroomId })
        .expect(200);

      // The English rooms are not the homerooms, so a homeroom move says nothing
      // about them — the label follows the child rather than being lost.
      const roster = await http()
        .get(`/api/enrollments/classroom/${secondClassroomId}/roster`)
        .set(auth(token))
        .expect(200);

      const moved = roster.body.find(
        (row: { studentId: { id?: string } | string }) =>
          String((row.studentId as { id?: string })?.id ?? row.studentId) === studentId,
      );
      expect(moved?.englishClass).toBe('EP-A');
    });

    it('filters the students list by English-programme room, and by having none', async () => {
      const inRoom = await createStudent('S-ENGFILTER-001', 'ນາງ');
      const noRoom = await createStudent('S-ENGFILTER-002', 'ນາງ');

      await http()
        .post('/api/enrollments')
        .set(auth(token))
        .send({ studentId: inRoom, classroomId, englishClass: 'EP-FILTER' })
        .expect(201);
      await http()
        .post('/api/enrollments')
        .set(auth(token))
        .send({ studentId: noRoom, classroomId: secondClassroomId })
        .expect(201);

      const inside = await http()
        .get('/api/students')
        .query({ englishClass: 'EP-FILTER', limit: 100 })
        .set(auth(token))
        .expect(200);

      const insideIds = inside.body.data.map((student: { id: string }) => student.id);
      expect(insideIds).toContain(inRoom);
      expect(insideIds).not.toContain(noRoom);

      // The question the office actually has while the column is still filling:
      // which placed children have not been given a room yet.
      const missing = await http()
        .get('/api/students')
        .query({ englishClassSet: 'false', limit: 100 })
        .set(auth(token))
        .expect(200);

      const missingIds = missing.body.data.map((student: { id: string }) => student.id);
      expect(missingIds).toContain(noRoom);
      expect(missingIds).not.toContain(inRoom);
    });

    it('lists the rooms in use, deduplicated and without the blanks', async () => {
      const first = await createStudent('S-ENGLIST-001', 'ນາງ');
      const second = await createStudent('S-ENGLIST-002', 'ນາງ');
      const third = await createStudent('S-ENGLIST-003', 'ນາງ');

      for (const [studentId, room] of [
        [first, 'EP-LIST-A'],
        [second, 'EP-LIST-A'],
        [third, undefined],
      ] as const) {
        await http()
          .post('/api/enrollments')
          .set(auth(token))
          .send({ studentId, classroomId, ...(room ? { englishClass: room } : {}) })
          .expect(201);
      }

      const response = await http()
        .get('/api/enrollments/english-classes')
        .set(auth(token))
        .expect(200);

      // One entry for the room two children share, and nothing for the child
      // with none — "no room" is its own filter, not a label.
      expect(response.body.filter((room: string) => room === 'EP-LIST-A')).toHaveLength(1);
      expect(response.body).not.toContain('');
      expect(response.body).not.toContain(null);
    });

    it('will not let a classroom be reassigned through the update route', async () => {
      const studentId = await createStudent('S-ENGCLASS-003', 'ນາງ');
      const enrollment = await http()
        .post('/api/enrollments')
        .set(auth(token))
        .send({ studentId, classroomId })
        .expect(201);

      // `forbidNonWhitelisted` is what keeps the headcounts honest: a placement
      // moved without the transfer path would leave both classrooms wrong.
      await http()
        .patch(`/api/enrollments/${enrollment.body.id}`)
        .set(auth(token))
        .send({ classroomId: secondClassroomId })
        .expect(400);
    });

    it('refuses an illegal status transition', async () => {
      // Its own code: `S-STATUS-001` belongs to the graduated-student test above,
      // and student codes are unique across the school.
      const studentId = await createStudent('S-ENROL-STATUS-001', 'ນາງ');
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

    /**
     * Everyone gets the same mark in every other subject, which leaves maths the
     * only thing that separates them and keeps the ranking below observable.
     */
    const OTHER_SUBJECT_MARK = 80;

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

      // The average divides by the subjects the grade sits, so a class marked in
      // maths alone stays provisional however complete maths is.
      const subjectCount = await markEveryGradeSubject(
        app,
        token,
        { gradeLevelId, semesterId, classroomId, studentIds },
        OTHER_SUBJECT_MARK,
      );

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

      // Maths: 38/40 → 95% of a 40 weight, 54/60 → 90% of a 60 weight ⇒ 92. Every
      // subject then counts once, so the term average is that plus 80 for each of
      // the others, over the number of subjects the grade sits.
      const expectedTop =
        Math.round(((92 + OTHER_SUBJECT_MARK * (subjectCount - 1)) / subjectCount) * 100) / 100;
      const top = ranked.find((r: { studentId: string }) => r.studentId === studentIds[0]);
      expect(top.rank).toBe(1);
      expect(top.average).toBe(expectedTop);

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
    /** The lesson the roll is called against — see `beforeAll`. */
    let lessonId: string;

    beforeAll(async () => {
      attendanceStudentId = await createStudent('S-ATT-001', 'ນາງ');
      await http()
        .post('/api/enrollments')
        .set(auth(token))
        .send({ studentId: attendanceStudentId, classroomId })
        .expect(201);

      /**
       * Roll call is taken against a **timetabled lesson**, not against a class
       * and a term, and only on a day that lesson is scheduled. So this describe
       * brings its own.
       *
       * A third subject, because all four pairings of the two subjects this file
       * uses with its two teachers are already on the timetable and one
       * teacher+subject+classroom may only be assigned once. Thursday and Friday,
       * because Monday to Wednesday are claimed by the tests around this one.
       */
      const subjects = await http()
        .get(`/api/subjects?gradeLevelId=${gradeLevelId}&role=marked&limit=100`)
        .set(auth(token))
        .expect(200);

      const spare = (subjects.body.data as { id: string }[]).find(
        (subject) => subject.id !== mathSubjectId && subject.id !== laoSubjectId,
      )!;

      const lesson = await http()
        .post('/api/teaching-assignments')
        .set(auth(token))
        .send({
          teacherId: otherTeacherId,
          subjectId: spare.id,
          classroomId,
          semesterId,
          schedule: [
            { dayOfWeek: 4, startTime: '15:10', endTime: '16:00', room: 'R104' },
            { dayOfWeek: 5, startTime: '15:10', endTime: '16:00', room: 'R104' },
          ],
        })
        .expect(201);
      lessonId = lesson.body.id;
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

    /**
     * A student's status and their enrollment's status are written by different
     * acts: the office marks a child as dropped, transferred or suspended without
     * closing the placement that put them in a room. The sheet is a roll to call,
     * so it follows the child; the placement roster is what the office fixes the
     * stale enrollment from, so it keeps showing the row.
     */
    it('leaves a student the office has taken off the roll off the sheet', async () => {
      const leaverId = await createStudent('S-LEAVE-001', 'ຄຳຫລ້າ');
      await http()
        .post('/api/enrollments')
        .set(auth(token))
        .send({ studentId: leaverId, classroomId })
        .expect(201);

      // Its own lesson, on a day and a teacher+subject pairing no other test
      // claims, so the sheet under test does not depend on what ran before it.
      await http()
        .post('/api/teaching-assignments')
        .set(auth(token))
        .send({
          teacherId: otherTeacherId,
          subjectId: mathSubjectId,
          classroomId,
          semesterId,
          schedule: [{ dayOfWeek: 3, startTime: '15:10', endTime: '16:00', room: 'R101' }],
        })
        .expect(201);

      // 2025-09-17 is the Wednesday that lesson falls on.
      const namedOnSheet = async () => {
        const sheet = await http()
          .get(`/api/attendances/daily-sheet?classroomId=${classroomId}&date=2025-09-17`)
          .set(auth(token))
          .expect(200);
        return sheet.body.lessons.some((lesson: { entries: { studentId: string }[] }) =>
          lesson.entries.some((entry) => entry.studentId === leaverId),
        );
      };

      expect(await namedOnSheet()).toBe(true);

      await http()
        .patch(`/api/students/${leaverId}`)
        .set(auth(token))
        .send({ status: 'dropped' })
        .expect(200);

      expect(await namedOnSheet()).toBe(false);

      // The enrollment is still open, and the placement screen still says so.
      const roster = await http()
        .get(`/api/enrollments/classroom/${classroomId}/roster`)
        .set(auth(token))
        .expect(200);
      expect(
        roster.body.some((row: { studentCode: string }) => row.studentCode === 'S-LEAVE-001'),
      ).toBe(true);
    });

    /**
     * Deleting the child, on the other hand, closes the placement with them.
     *
     * A deleted student and an open enrollment are a row nothing can resolve:
     * roll call keeps printing it — nameless, because the nickname is joined
     * from the student record that has gone — and no screen downstream will drop
     * it, since a ref that cannot be read is deliberately taken as no evidence
     * either way. It happened for real in ມ.5 in August 2026, to a duplicate the
     * office deleted two minutes after enrolling it.
     */
    it('closes the placements of a student the office deletes, count and all', async () => {
      const goneId = await createStudent('S-GONE-001', 'ບຸນຍະກຽດ');
      await http()
        .post('/api/enrollments')
        .set(auth(token))
        .send({ studentId: goneId, classroomId })
        .expect(201);

      const onRoster = async () => {
        const roster = await http()
          .get(`/api/enrollments/classroom/${classroomId}/roster`)
          .set(auth(token))
          .expect(200);
        return roster.body.some((row: { studentCode: string }) => row.studentCode === 'S-GONE-001');
      };
      const rosterSize = async () => {
        const classroom = await http()
          .get(`/api/classrooms/${classroomId}`)
          .set(auth(token))
          .expect(200);
        return classroom.body.currentCount as number;
      };

      expect(await onRoster()).toBe(true);
      const counted = await rosterSize();

      await http().delete(`/api/students/${goneId}`).set(auth(token)).expect(204);

      expect(await onRoster()).toBe(false);
      // The room's cached size comes down too, or the next placement is refused
      // against a class that is not as full as it says.
      expect(await rosterSize()).toBe(counted - 1);
    });

    /**
     * A corrected register name reaches the placements that snapshot it.
     *
     * The enrollment carries `studentNameLo` taken on the day of placement, and
     * the mark sheets, the score grid and the behaviour register all render from
     * that copy rather than from the child — so a misspelling fixed on the
     * student record used to stay on every one of those screens. `ສັນຍາຮັກ
     * ວົົງສາ` sat that way in ມ.5 for a month.
     */
    it('carries a corrected register name into the placements that snapshot it', async () => {
      const misspeltId = await createStudent('S-TYPO-001', 'ສັນຍາຮັກ');
      await http()
        .post('/api/enrollments')
        .set(auth(token))
        .send({ studentId: misspeltId, classroomId })
        .expect(201);

      const snapshot = async () => {
        const roster = await http()
          .get(`/api/enrollments/classroom/${classroomId}/roster`)
          .set(auth(token))
          .expect(200);
        const row = roster.body.find(
          (candidate: { studentCode: string }) => candidate.studentCode === 'S-TYPO-001',
        ) as { studentNameLo: string } | undefined;
        return row?.studentNameLo;
      };

      expect(await snapshot()).toBe('ສັນຍາຮັກ ວົງສະຫວັນ');

      await http()
        .patch(`/api/students/${misspeltId}`)
        .set(auth(token))
        .send({ lastNameLo: 'ວົງສາ' })
        .expect(200);

      expect(await snapshot()).toBe('ສັນຍາຮັກ ວົງສາ');
    });

    /**
     * Roll numbers are issued off the register, so nobody is handed one twice.
     *
     * They used to be `currentCount + 1`, which is a count of who is in the room
     * rather than a record of what has been handed out: remove anybody, and the
     * next child enrolled was given the number the student at the foot of the
     * list already wore. Five classes were carrying a duplicated roll number by
     * September 2026 — ມ.5 had two 10s and no 26.
     */
    it('issues the next roll number past the highest, not past the head count', async () => {
      const first = await createStudent('S-ROLL-001', 'ນາລີ');
      const second = await createStudent('S-ROLL-002', 'ພອນສະຫວັນ');

      const place = async (studentId: string) => {
        const response = await http()
          .post('/api/enrollments')
          .set(auth(token))
          .send({ studentId, classroomId })
          .expect(201);
        return response.body as { id: string; rollNumber: number };
      };

      const placed = await place(first);
      // Taking them off the roll brings the room's count back down; the number
      // they were issued stays spent.
      await http().delete(`/api/students/${first}`).set(auth(token)).expect(204);

      expect((await place(second)).rollNumber).toBe(placed.rollNumber + 1);
    });

    it('records a roll call', async () => {
      // 2025-09-18 is the Thursday that lesson falls on.
      const response = await http()
        .post('/api/attendances')
        .set(auth(token))
        .send({
          teachingAssignmentId: lessonId,
          date: '2025-09-18',
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
          teachingAssignmentId: lessonId,
          date: '2025-09-18',
          entries: [{ studentId: attendanceStudentId, status: 'late', minutesLate: 15 }],
        })
        .expect(200);

      const records = await http()
        .get(`/api/attendances?studentId=${attendanceStudentId}&from=2025-09-18&to=2025-09-18`)
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
          teachingAssignmentId: lessonId,
          // A Thursday, so the lesson *is* scheduled and the date is the only
          // thing wrong with the request.
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
          teachingAssignmentId: lessonId,
          // Also a Thursday, and well before the term opened.
          date: '2024-01-18',
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
          teachingAssignmentId: lessonId,
          // The Friday of the same lesson, so this is a second day and not a
          // correction to the Thursday above.
          date: '2025-09-19',
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

    /**
     * ວັນຂາດ on the monthly mark sheet is the month's, not the term's.
     *
     * The sheet is headed with one month and read out at the end of it, so a
     * class summary that could only answer for the whole term would print
     * ກັນຍາ's absences under ຕຸລາ and grow all year.
     */
    it('narrows the class summary to one calendar month', async () => {
      // A Thursday in ຕຸລາ, so the same lesson falls on it — a second month of
      // the same term rather than a second term.
      await http()
        .post('/api/attendances')
        .set(auth(token))
        .send({
          teachingAssignmentId: lessonId,
          date: '2025-10-16',
          entries: [{ studentId: attendanceStudentId, status: 'excused' }],
        })
        .expect(200);

      const rowFor = async (query: string) => {
        const response = await http()
          .get(`/api/attendances/summary/classroom/${classroomId}/semester/${semesterId}${query}`)
          .set(auth(token))
          .expect(200);
        return response.body.find(
          (row: { studentId: string }) => row.studentId === attendanceStudentId,
        );
      };

      const [term, september, october] = await Promise.all([
        rowFor(''),
        rowFor('?month=9'),
        rowFor('?month=10'),
      ]);

      expect(september.absent).toBe(1);
      expect(september.late).toBe(1);
      expect(september.excused).toBe(0);

      expect(october.excused).toBe(1);
      expect(october.absent).toBe(0);
      expect(october.totalRecorded).toBe(1);

      // The months of a term add up to it: nothing is double-counted and
      // nothing falls between them.
      expect(september.totalRecorded + october.totalRecorded).toBe(term.totalRecorded);
    });

    it('lists the lessons behind a summary — everything but present, with subject and teacher', async () => {
      // The tests above left this student late on 18 Sep, absent on the 19th
      // and excused on 16 Oct. One more lesson, marked present, must stay out.
      await http()
        .post('/api/attendances')
        .set(auth(token))
        .send({
          teachingAssignmentId: lessonId,
          date: '2025-09-25',
          entries: [{ studentId: attendanceStudentId, status: 'present' }],
        })
        .expect(200);

      const records = await http()
        .get(`/api/attendances?studentId=${attendanceStudentId}&notPresent=true`)
        .set(auth(token))
        .expect(200);

      expect(records.body.meta.total).toBe(3);
      const rows = records.body.data as { status: string; date: string }[];
      expect(rows.map((row) => row.status)).toEqual(['excused', 'absent', 'late']);
      expect(rows.some((row) => row.status === 'present')).toBe(false);
      // The reader wants to know which lesson and whose, not two ids.
      expect(records.body.data[0].subjectId).toMatchObject({ nameLo: expect.any(String) });
      expect(records.body.data[0].teacherId).toMatchObject({ firstNameLo: expect.any(String) });

      // A named status still wins over the flag.
      const present = await http()
        .get(`/api/attendances?studentId=${attendanceStudentId}&notPresent=true&status=present`)
        .set(auth(token))
        .expect(200);
      expect(present.body.meta.total).toBe(1);
      expect(present.body.data[0].date).toBe('2025-09-25T00:00:00.000Z');
    });

    /**
     * The office reads a stretch that is not a calendar month — the fortnight
     * before an exam — and a teacher reads their own subject alone. Both narrow
     * the counts and the rate together, so the rate is the window's own.
     */
    it('narrows a summary to a date range, and to one subject', async () => {
      // On file for this student: late 18 Sep, absent 19 Sep, present 25 Sep,
      // excused 16 Oct — all in the same lesson's subject.
      const rowFor = async (query: string) => {
        const response = await http()
          .get(`/api/attendances/summary/classroom/${classroomId}/semester/${semesterId}${query}`)
          .set(auth(token))
          .expect(200);
        return response.body.find(
          (row: { studentId: string }) => row.studentId === attendanceStudentId,
        );
      };

      const window = await rowFor('?from=2025-09-19&to=2025-09-25');
      expect(window.absent).toBe(1);
      expect(window.present).toBe(1);
      expect(window.late).toBe(0);
      expect(window.totalRecorded).toBe(2);
      expect(window.attendanceRate).toBe(50);

      // The bounds are inclusive on both ends.
      expect((await rowFor('?from=2025-09-18&to=2025-09-18')).late).toBe(1);

      const records = await http()
        .get(`/api/attendances?studentId=${attendanceStudentId}&limit=1`)
        .set(auth(token))
        .expect(200);
      const lessonSubjectId = records.body.data[0].subjectId.id as string;

      expect((await rowFor(`?subjectId=${lessonSubjectId}`)).totalRecorded).toBe(4);
      // No maths lesson was ever marked for this student, so they drop out of
      // the list rather than coming back as zeroes — the caller holds the roll.
      expect(await rowFor(`?subjectId=${mathSubjectId}`)).toBeUndefined();

      // The student's own summary takes the same window.
      const own = await http()
        .get(
          `/api/attendances/summary/student/${attendanceStudentId}/semester/${semesterId}` +
            `?from=2025-10-01&subjectId=${lessonSubjectId}`,
        )
        .set(auth(token))
        .expect(200);
      expect(own.body.excused).toBe(1);
      expect(own.body.totalRecorded).toBe(1);
    });

    it('rejects a month outside 1–12', async () => {
      await http()
        .get(`/api/attendances/summary/classroom/${classroomId}/semester/${semesterId}?month=13`)
        .set(auth(token))
        .expect(400);
    });

    /**
     * Three late arrivals are a day absent without a reason, as far as the
     * office is concerned. The rule is applied when the counts are read, so it
     * reaches every sheet through the same figures — see `absence-days.ts`.
     */
    it('counts three lates as one unexcused absence, and says so', async () => {
      // On file: late 18 Sep, absent 19 Sep, present 25 Sep, excused 16 Oct.
      // Two more lates on lesson days make three.
      for (const date of ['2025-09-26', '2025-10-02']) {
        await http()
          .post('/api/attendances')
          .set(auth(token))
          .send({
            teachingAssignmentId: lessonId,
            date,
            entries: [{ studentId: attendanceStudentId, status: 'late', minutesLate: 5 }],
          })
          .expect(200);
      }

      const summary = await http()
        .get(`/api/attendances/summary/student/${attendanceStudentId}/semester/${semesterId}`)
        .set(auth(token))
        .expect(200);

      expect(summary.body).toMatchObject({
        late: 3,
        absent: 1,
        excused: 1,
        totalRecorded: 6,
        latesPerAbsence: 3,
        lateAsAbsent: 1,
        lateRemainder: 0,
        absentUnexcused: 2,
        absentExcused: 1,
        absentTotal: 3,
      });
      // Six lessons, two of them now days absent: the rate follows the rule.
      expect(summary.body.attendanceRate).toBe(66.67);
    });

    /**
     * The office asks "who is at 15 days, and 30" of the whole school, not of
     * one room at a time, and wants the room beside the name.
     */
    it('lists every student over an absence threshold, with their room', async () => {
      // This student stands at 3 ວັນຂາດ: 2 without a reason (one of them the
      // three lates), 1 with.
      const listed = await http()
        .get(`/api/attendances/summary/semester/${semesterId}/absences?minAbsentDays=3`)
        .set(auth(token))
        .expect(200);

      const row = listed.body.find(
        (entry: { studentId: string }) => entry.studentId === attendanceStudentId,
      );
      expect(row).toMatchObject({
        absentTotal: 3,
        absentUnexcused: 2,
        absentExcused: 1,
        studentCode: 'S-ATT-001',
        classroomId,
      });
      expect(row.studentNameLo).toEqual(expect.any(String));
      expect(row.classroomName).toEqual(expect.any(String));
      expect(row.gradeLevelCode).toBe('m4');

      // One day short of the line, they are not listed.
      const above = await http()
        .get(`/api/attendances/summary/semester/${semesterId}/absences?minAbsentDays=4`)
        .set(auth(token))
        .expect(200);
      expect(
        above.body.some((entry: { studentId: string }) => entry.studentId === attendanceStudentId),
      ).toBe(false);

      // The threshold is required: the list without one would be the school.
      await http()
        .get(`/api/attendances/summary/semester/${semesterId}/absences`)
        .set(auth(token))
        .expect(400);
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

  /**
   * ຕັດຄະແນນກົດລະບຽບ — the discipline ledger.
   *
   * The whole promise of the feature is arithmetic nobody has to do by hand: the
   * rule decides the cost, the ledger decides the balance, the balance decides
   * the rung, and the term's conduct mark follows without a second act of data
   * entry. That chain is what these assert, end to end.
   */
  describe('conduct deductions', () => {
    // Inside the seeded term (2025-09-01 – 2026-01-31), and in the past.
    const day = '2025-09-16';
    let ruleId: string;
    let deductionStudentId: string;

    beforeAll(async () => {
      ruleId = await http()
        .post('/api/conduct-rules')
        .set(auth(token))
        .send({
          code: 'E2E-2.1',
          points: 10,
          nameLo: 'ໃຊ້ໂທລະສັບໃນເວລາຮຽນ',
          nameEn: 'Using a phone during class',
        })
        .expect(201)
        .then((response) => response.body.id as string);

      deductionStudentId = await createStudent('S-DED-001', 'ຄຳຫລ້າ');
      await http()
        .post('/api/enrollments')
        .set(auth(token))
        .send({ studentId: deductionStudentId, classroomId })
        .expect(201);
    });

    it('takes the rule’s points, and says which rung that reaches', async () => {
      const response = await http()
        .post('/api/conduct-deductions')
        .set(auth(token))
        .send({ classroomId, ruleId, date: day, studentIds: [deductionStudentId] })
        .expect(201);

      expect(response.body.recorded).toBe(1);
      const outcome = response.body.students[0];
      expect(outcome.deducted).toBe(10);
      expect(outcome.remaining).toBe(90);
      // ຂັ້ນຫ້ອງ: handled by the homeroom teacher, and nobody else yet.
      expect(outcome.level).toBe('classroom');
      expect(outcome.notify).toEqual(['homeroomTeacher', 'student']);
    });

    it('publishes the balance as the term’s conduct score', async () => {
      const scores = await http()
        .get(`/api/conduct-scores?studentId=${deductionStudentId}&semesterId=${semesterId}`)
        .set(auth(token))
        .expect(200);

      const term = scores.body.data.find(
        (row: { periodType: string }) => row.periodType === 'semester',
      );
      expect(term.score).toBe(90);
      expect(term.grade).toBe('excellent');
      // Marked as the ledger's, which is what stops a later deduction from
      // overwriting a figure the office set by hand.
      expect(term.source).toBe('deductions');
    });

    it('lists the whole roll, so a clean record is visible as one', async () => {
      const standing = await http()
        .get(`/api/conduct-deductions/summary/classroom/${classroomId}/school-year/${schoolYearId}`)
        .set(auth(token))
        .expect(200);

      const deducted = standing.body.find(
        (row: { studentId: string }) => row.studentId === deductionStudentId,
      );
      expect(deducted).toMatchObject({ deducted: 10, remaining: 90, level: 'classroom' });

      // Somebody else in the same room who has done nothing: on the full 100,
      // and on the page rather than missing from it.
      const clean = standing.body.find(
        (row: { studentId: string }) => row.studentId !== deductionStudentId,
      );
      expect(clean.remaining).toBe(100);
      expect(clean.level).toBe('none');
      // Worst first, which is the order it is acted on.
      expect(standing.body[0].deducted).toBeGreaterThanOrEqual(
        standing.body[standing.body.length - 1].deducted,
      );
    });

    /**
     * ຄະແນນຄຸນສົມບັດ is a year's budget, and every term of the year is published
     * from it.
     *
     * The school issues the 100 once a school year, so ພາກຮຽນ II opens on
     * whatever ພາກຮຽນ I left rather than back on 100. One deduction therefore
     * writes a conduct score into *both* terms — each holding the balance as it
     * stood at the end of that term — and a report card printed from either
     * cannot contradict the ledger.
     */
    it('publishes the year\u2019s balance into every term of the year', async () => {
      const terms = await http()
        .get(`/api/semesters?schoolYearId=${schoolYearId}&limit=10`)
        .set(auth(token))
        .expect(200);
      expect(terms.body.data.length).toBeGreaterThan(1);

      const scores = await http()
        .get(`/api/conduct-scores?studentId=${deductionStudentId}&limit=20`)
        .set(auth(token))
        .expect(200);

      const published = scores.body.data.filter(
        (row: { periodType: string; source: string }) =>
          row.periodType === 'semester' && row.source === 'deductions',
      );
      expect(published).toHaveLength(terms.body.data.length);
      // Every row was filed inside ພາກຮຽນ I, so both terms stand at the same
      // balance — ພາກຮຽນ II carrying it rather than resetting is the point.
      for (const row of published) expect(row.score).toBe(90);
    });

    it('escalates to the guardians once the year’s total passes ຂັ້ນ 1', async () => {
      const response = await http()
        .post('/api/conduct-deductions')
        .set(auth(token))
        .send({ classroomId, ruleId, date: day, studentIds: [deductionStudentId] })
        .expect(201);

      const outcome = response.body.students[0];
      expect(outcome.deducted).toBe(20);
      expect(outcome.remaining).toBe(80);
      expect(outcome.level).toBe('level1');
      expect(outcome.notify).toContain('guardian');
    });

    it('refuses a rule that has been applied to be deleted, and withdraws instead', async () => {
      await http().delete(`/api/conduct-rules/${ruleId}`).set(auth(token)).expect(409);

      await http()
        .patch(`/api/conduct-rules/${ruleId}`)
        .set(auth(token))
        .send({ isActive: false })
        .expect(200);

      // Withdrawn means it stops being offered, not that history changes.
      await http()
        .post('/api/conduct-deductions')
        .set(auth(token))
        .send({ classroomId, ruleId, date: day, studentIds: [deductionStudentId] })
        .expect(400);

      await http()
        .patch(`/api/conduct-rules/${ruleId}`)
        .set(auth(token))
        .send({ isActive: true })
        .expect(200);
    });

    it('gives the points back when a deduction is withdrawn, with the reason kept', async () => {
      const ledger = await http()
        .get(`/api/conduct-deductions/student/${deductionStudentId}/school-year/${schoolYearId}`)
        .set(auth(token))
        .expect(200);

      expect(ledger.body.entries).toHaveLength(2);
      expect(ledger.body.remaining).toBe(80);

      const revoked = await http()
        .delete(`/api/conduct-deductions/${ledger.body.entries[0].id}`)
        .set(auth(token))
        .send({ reason: 'ບັນທຶກຜິດຄົນ' })
        .expect(200);

      expect(revoked.body.deducted).toBe(10);
      expect(revoked.body.remaining).toBe(90);
      // The published mark follows the ledger back up.
      expect(revoked.body.level).toBe('classroom');

      const after = await http()
        .get(`/api/conduct-deductions/student/${deductionStudentId}/school-year/${schoolYearId}`)
        .set(auth(token))
        .expect(200);
      expect(after.body.entries).toHaveLength(1);

      const score = await http()
        .get(`/api/conduct-scores?studentId=${deductionStudentId}&semesterId=${semesterId}`)
        .set(auth(token))
        .expect(200);
      expect(
        score.body.data.find((row: { periodType: string }) => row.periodType === 'semester').score,
      ).toBe(90);
    });

    /**
     * The sheet is read whole by the screen that records against it, so how the
     * list endpoint answers is not a detail: a page it refuses, or a withdrawn
     * rule it hands back, both surface as a teacher picking the wrong line.
     */
    it('serves the sheet in its printed order, without the withdrawn items', async () => {
      const cheapId = await http()
        .post('/api/conduct-rules')
        .set(auth(token))
        .send({ code: 'E2E-1.1', points: 5, nameLo: 'ນຸ່ງເຄື່ອງບໍ່ຖືກລະບຽບ' })
        .expect(201)
        .then((response) => response.body.id as string);

      await http()
        .patch(`/api/conduct-rules/${cheapId}`)
        .set(auth(token))
        .send({ isActive: false })
        .expect(200);

      // The page size the screen asks for. Above the API's cap this is a 400,
      // not a shorter page — and the screen would render that as an empty sheet.
      const inForce = await http().get('/api/conduct-rules?limit=100').set(auth(token)).expect(200);

      const codes = inForce.body.data.map((rule: { code: string }) => rule.code);
      expect(codes).toContain('E2E-2.1');
      expect(codes).not.toContain('E2E-1.1');

      // Cheapest column first, which is how the sheet is printed and read.
      const points = inForce.body.data.map((rule: { points: number }) => rule.points);
      expect(points).toEqual([...points].sort((a: number, b: number) => a - b));

      // And within a column, where the number says — a rule the office adds
      // must not land above the one before it just because it was typed later.
      await http()
        .post('/api/conduct-rules')
        .set(auth(token))
        .send({ code: 'E2E-2.9', points: 10, nameLo: 'ອອກຈາກຫ້ອງໂດຍບໍ່ໄດ້ຮັບອະນຸຍາດ' })
        .expect(201);

      const reread = await http().get('/api/conduct-rules?limit=100').set(auth(token)).expect(200);
      const tenPointColumn = reread.body.data
        .filter((rule: { points: number; code: string }) => rule.code.startsWith('E2E-2.'))
        .map((rule: { code: string }) => rule.code);
      expect(tenPointColumn).toEqual(['E2E-2.1', 'E2E-2.9']);

      const withWithdrawn = await http()
        .get('/api/conduct-rules?limit=100&includeWithdrawn=true')
        .set(auth(token))
        .expect(200);
      expect(withWithdrawn.body.data.map((rule: { code: string }) => rule.code)).toContain(
        'E2E-1.1',
      );

      // `false` has to mean false. Cast with `Boolean(value)` it would not:
      // every non-empty string is truthy, so the office would be shown rules
      // that are no longer in force.
      const explicitlyFalse = await http()
        .get('/api/conduct-rules?limit=100&includeWithdrawn=false')
        .set(auth(token))
        .expect(200);
      expect(explicitlyFalse.body.data.map((rule: { code: string }) => rule.code)).not.toContain(
        'E2E-1.1',
      );
    });

    it('refuses a deduction dated outside every term, and one in the future', async () => {
      await http()
        .post('/api/conduct-deductions')
        .set(auth(token))
        .send({ classroomId, ruleId, date: '2019-05-05', studentIds: [deductionStudentId] })
        .expect(400);

      await http()
        .post('/api/conduct-deductions')
        .set(auth(token))
        .send({ classroomId, ruleId, date: '2099-05-05', studentIds: [deductionStudentId] })
        .expect(400);
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
  /**
   * Last in the file on purpose: this block enrols a student of its own, and the
   * enrolment and attendance blocks above it assert on a classroom's head count.
   */
  /**
   * ຄະແນນປະຈຳເດືອນ — the columns a subject is marked on.
   *
   * ສັງຄົມ takes no ປື້ມ mark and its point goes to ກິດຈະກຳ, so that column runs to
   * 3 there and to 2 everywhere else. The rule has one owner — the subject's own
   * `monthlyColumnMax`, checked in `MonthlyMarksService` — and the DTO used to
   * carry a second copy of the ordinary scheme. The copy ran first, so a teacher
   * marking ກິດຈະກຳ 3 was refused by `ValidationPipe` with nothing but
   * "ຂໍ້ມູນທີ່ສົ່ງມາບໍ່ຖືກຕ້ອງ", and the office could not enter the month at all.
   */
  describe('monthly marks — a subject marked on its own columns', () => {
    let socialSubjectId: string;
    let markedStudentId: string;

    beforeAll(async () => {
      // A subject of this grade put onto the ສັງຄົມ scheme, the way the office
      // does it: ຂື້ນຫ້ອງ 1 · ປື້ມ 0 · ກິດຈະກຳ 3 · ກວດກາ 6, still totalling 10.
      const subjects = await http()
        .get(`/api/subjects?gradeLevelId=${gradeLevelId}&role=marked&limit=100`)
        .set(auth(token))
        .expect(200);
      socialSubjectId = (subjects.body.data as { id: string }[]).find(
        (subject) => subject.id !== mathSubjectId && subject.id !== laoSubjectId,
      )!.id;

      await http()
        .patch(`/api/subjects/${socialSubjectId}`)
        .set(auth(token))
        .send({ monthlyColumnMax: { attendance: 1, notebook: 0, activity: 3, test: 6 } })
        .expect(200);

      markedStudentId = await createStudent('S-MM-001', 'ນາງ');
      await http()
        .post('/api/enrollments')
        .set(auth(token))
        .send({ studentId: markedStudentId, classroomId })
        .expect(201);
    });

    it('accepts ກິດຈະກຳ 3 for a subject whose column runs to 3', async () => {
      const response = await http()
        .post('/api/monthly-marks/month')
        .set(auth(token))
        .send({
          subjectId: socialSubjectId,
          classroomId,
          semesterId,
          month: 9,
          entries: [{ studentId: markedStudentId, attendance: 1, activity: 3, test: 5 }],
        })
        .expect(201);

      expect(response.body).toMatchObject({ saved: 1, errors: [] });
    });

    it('still refuses a mark above that subject’s own maximum, and says which', async () => {
      const response = await http()
        .post('/api/monthly-marks/month')
        .set(auth(token))
        .send({
          subjectId: socialSubjectId,
          classroomId,
          semesterId,
          month: 9,
          entries: [{ studentId: markedStudentId, activity: 4 }],
        })
        .expect(201);

      // Per row rather than per request: one bad cell must not throw away the
      // rest of a class's month. The error names the column and the mark it is
      // actually out of, which the pipe's "validation failed" never could.
      expect(response.body.saved).toBe(0);
      expect(response.body.errors[0]).toMatchObject({
        studentId: markedStudentId,
        reason: 'score.exceedsMax',
      });
    });

    it('refuses a column the subject is not marked on at all', async () => {
      const response = await http()
        .post('/api/monthly-marks/month')
        .set(auth(token))
        .send({
          subjectId: socialSubjectId,
          classroomId,
          semesterId,
          month: 9,
          // ປື້ມ is not kept for this subject — a mark under it would count
          // towards ລວມ with no cell on the form to see or correct it.
          entries: [{ studentId: markedStudentId, notebook: 1 }],
        })
        .expect(201);

      expect(response.body.saved).toBe(0);
      expect(response.body.errors[0]).toMatchObject({
        studentId: markedStudentId,
        reason: 'score.columnNotMarked',
      });
    });

    it('keeps ກິດຈະກຳ at 2 for a subject on the ordinary scheme', async () => {
      const response = await http()
        .post('/api/monthly-marks/month')
        .set(auth(token))
        .send({
          subjectId: mathSubjectId,
          classroomId,
          semesterId,
          month: 9,
          entries: [{ studentId: markedStudentId, activity: 3 }],
        })
        .expect(201);

      // Loosening the DTO must not loosen the rule: 3 is still too much here.
      expect(response.body.saved).toBe(0);
      expect(response.body.errors[0]).toMatchObject({ reason: 'score.exceedsMax' });
    });
  });

  /**
   * ການສົ່ງມອບການສອນ — a teacher leaves and somebody takes their posts on.
   *
   * The school had this happen mid-term, to a teacher who was also a ຄູປະຈຳຫ້ອງ,
   * and the system's answer was a six-step checklist across three screens whose
   * every omission failed silently: a homeroom nobody moved keeps the departed
   * teacher's name on the ວັນພຸດ/ວັນສຸກ report and sends its reminders to an
   * account that cannot sign in.
   *
   * Its own teachers, classroom and lesson, because several blocks above assert on
   * a classroom's head count and on the seeded teachers' timetables.
   */
  /**
   * ປ່ຽນຕາຕະລາງ — a lesson moved mid-term.
   *
   * The timetable is a fact about each day, not about now. Every report derives
   * which days a lesson was owed on by reading its weekday, so a schedule replaced
   * in place used to change the weeks behind it too: Mondays a teacher had taught
   * and marked stopped counting, and Wednesdays they had never taught appeared as
   * gaps, back to the start of term — and the punctuality report defaults to the
   * whole term to date.
   */
  describe('timetable revision', () => {
    let movedLessonId: string;
    let movedRoomId: string;

    /** Its own teacher and room, so moving the lesson cannot clash with anything. */
    beforeAll(async () => {
      const teacher = await http()
        .post('/api/teachers')
        .set(auth(token))
        .send({ firstNameLo: 'ຜູ້ສອນ', lastNameLo: 'ຕາຕະລາງ', gender: 'male' })
        .expect(201);

      const room = await http()
        .post('/api/classrooms')
        .set(auth(token))
        .send({ schoolYearId, gradeLevelId, name: 'ຕ', capacity: 40 })
        .expect(201);
      movedRoomId = room.body.id;

      const lesson = await http()
        .post('/api/teaching-assignments')
        .set(auth(token))
        .send({
          teacherId: teacher.body.id,
          subjectId: laoSubjectId,
          classroomId: movedRoomId,
          semesterId,
          // Monday, to begin with. Inside the seeded school day, which this school
          // runs in the afternoon.
          schedule: [{ dayOfWeek: 1, startTime: '15:10', endTime: '16:00' }],
        })
        .expect(201);
      movedLessonId = lesson.body.id;
    });

    it('records the days the old arrangement applied to', async () => {
      const response = await http()
        .patch(`/api/teaching-assignments/${movedLessonId}`)
        .set(auth(token))
        .send({
          schedule: [{ dayOfWeek: 3, startTime: '15:10', endTime: '16:00' }],
          effectiveFrom: '2025-10-01',
          scheduleNote: 'ປ່ຽນຕາຕະລາງກາງເທີມ',
        })
        .expect(200);

      expect(response.body.schedule).toEqual([expect.objectContaining({ dayOfWeek: 3 })]);

      const history = response.body.scheduleHistory as {
        schedule: { dayOfWeek: number }[];
        from: string;
        to: string | null;
        note: string | null;
      }[];
      // Two spells: the Monday arrangement, now closed, and the Wednesday one in
      // force. They meet exactly, so a question about any day lands in one.
      expect(history).toHaveLength(2);
      expect(history[0].schedule).toEqual([expect.objectContaining({ dayOfWeek: 1 })]);
      expect(history[0].to).toBe(history[1].from);
      expect(history[1].schedule).toEqual([expect.objectContaining({ dayOfWeek: 3 })]);
      expect(history[1].to).toBeNull();
      expect(history[1].note).toBe('ປ່ຽນຕາຕະລາງກາງເທີມ');
    });

    it('still owes the old weekday for the weeks before the change', async () => {
      // 22 Sep 2025 is a Monday, before the revision took effect.
      const before = await http()
        .get(`/api/attendances/coverage?weekOf=2025-09-22&classroomId=${movedRoomId}`)
        .set(auth(token))
        .expect(200);

      const row = (
        before.body.rows as { teachingAssignmentId: string; lessonDates: string[] }[]
      ).find((candidate) => candidate.teachingAssignmentId === movedLessonId);
      expect(row?.lessonDates).toEqual(['2025-09-22']);
    });

    it('owes the new weekday once the change has taken effect', async () => {
      // The week of 6 Oct 2025: Wednesday the 8th, not Monday the 6th.
      const after = await http()
        .get(`/api/attendances/coverage?weekOf=2025-10-06&classroomId=${movedRoomId}`)
        .set(auth(token))
        .expect(200);

      const row = (
        after.body.rows as { teachingAssignmentId: string; lessonDates: string[] }[]
      ).find((candidate) => candidate.teachingAssignmentId === movedLessonId);
      expect(row?.lessonDates).toEqual(['2025-10-08']);
    });

    it('takes a correction back to the start, when that is what is meant', async () => {
      // Backdating before the lesson existed is how the office says "this is what
      // the timetable always should have said" — no "before" is recorded.
      const response = await http()
        .patch(`/api/teaching-assignments/${movedLessonId}`)
        .set(auth(token))
        .send({
          schedule: [{ dayOfWeek: 5, startTime: '15:10', endTime: '16:00' }],
          effectiveFrom: '2020-01-01',
        })
        .expect(200);

      const history = response.body.scheduleHistory as { from: string; to: string | null }[];
      const open = history.filter((spell) => spell.to === null);
      expect(open).toHaveLength(1);
      expect(open[0].from.slice(0, 10)).toBe('2020-01-01');

      // Every week now reads under the corrected arrangement — Friday the 26th.
      const week = await http()
        .get(`/api/attendances/coverage?weekOf=2025-09-22&classroomId=${movedRoomId}`)
        .set(auth(token))
        .expect(200);
      const row = (
        week.body.rows as { teachingAssignmentId: string; lessonDates: string[] }[]
      ).find((candidate) => candidate.teachingAssignmentId === movedLessonId);
      expect(row?.lessonDates).toEqual(['2025-09-26']);
    });
  });

  describe('teacher handover', () => {
    let outgoingId: string;
    let incomingId: string;
    let handoverRoomId: string;
    let handoverLessonId: string;

    const makeTeacher = async (firstNameLo: string): Promise<string> => {
      const response = await http()
        .post('/api/teachers')
        .set(auth(token))
        .send({ firstNameLo, lastNameLo: 'ຜູ້ສອນ', gender: 'female' })
        .expect(201);
      return response.body.id as string;
    };

    beforeAll(async () => {
      outgoingId = await makeTeacher('ຜູ້ໄປ');
      incomingId = await makeTeacher('ຜູ້ມາ');

      const room = await http()
        .post('/api/classrooms')
        .set(auth(token))
        .send({ schoolYearId, gradeLevelId, name: 'ຮ', capacity: 40 })
        .expect(201);
      handoverRoomId = room.body.id;

      await http()
        .patch(`/api/classrooms/${handoverRoomId}`)
        .set(auth(token))
        .send({ homeroomTeacherId: outgoingId })
        .expect(200);

      const lesson = await http()
        .post('/api/teaching-assignments')
        .set(auth(token))
        .send({
          teacherId: outgoingId,
          subjectId: mathSubjectId,
          classroomId: handoverRoomId,
          semesterId,
          schedule: [{ dayOfWeek: 2, startTime: '15:10', endTime: '16:00', room: 'R200' }],
        })
        .expect(201);
      handoverLessonId = lesson.body.id;
    });

    it('lists the posts a departure would leave vacant, and not the history', async () => {
      const response = await http()
        .get(`/api/teachers/${outgoingId}/commitments`)
        .set(auth(token))
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'active',
        hasActiveAccount: false,
        isAcademicHead: false,
      });
      expect(response.body.assignments).toHaveLength(1);
      expect(response.body.homerooms).toEqual([
        expect.objectContaining({ id: handoverRoomId, name: 'ຮ', gradeLevelCode: 'm4' }),
      ]);
    });

    it('refuses to delete a teacher who still holds a post, and says what', async () => {
      // There was no guard here at all: a deleted teacher kept their timetable and
      // their homeroom, so the coverage report went on naming them while they
      // vanished from every picker the office would have used to fix it.
      const response = await http()
        .delete(`/api/teachers/${outgoingId}`)
        .set(auth(token))
        .expect(409);

      expect(response.body.messageKey).toBe('teacher.stillResponsible');
      expect(response.body.details).toMatchObject({ assignments: 1, homerooms: ['m4/ຮ'] });
    });

    it('refuses a handover to the same teacher, or to one who has left themselves', async () => {
      const toSelf = await http()
        .post(`/api/teachers/${outgoingId}/handover`)
        .set(auth(token))
        .send({ toTeacherId: outgoingId })
        .expect(400);
      expect(toSelf.body.messageKey).toBe('teacher.handoverToSelf');

      const retired = await makeTeacher('ຜູ້ບຳນານ');
      await http()
        .patch(`/api/teachers/${retired}`)
        .set(auth(token))
        .send({ status: 'retired' })
        .expect(200);

      const toRetired = await http()
        .post(`/api/teachers/${outgoingId}/handover`)
        .set(auth(token))
        .send({ toTeacherId: retired })
        .expect(400);
      expect(toRetired.body.messageKey).toBe('teacher.handoverTargetInactive');
    });

    it('refuses to double-book the teacher taking over', async () => {
      // Their own lesson at the same time on the same day. Refused whole rather
      // than partly moved: half a timetable is a timetable nobody can read.
      const clashRoom = await http()
        .post('/api/classrooms')
        .set(auth(token))
        .send({ schoolYearId, gradeLevelId, name: 'ຯ', capacity: 40 })
        .expect(201);

      const clash = await http()
        .post('/api/teaching-assignments')
        .set(auth(token))
        .send({
          teacherId: incomingId,
          subjectId: laoSubjectId,
          classroomId: clashRoom.body.id,
          semesterId,
          schedule: [{ dayOfWeek: 2, startTime: '15:10', endTime: '16:00' }],
        })
        .expect(201);

      const response = await http()
        .post(`/api/teachers/${outgoingId}/handover`)
        .set(auth(token))
        .send({ toTeacherId: incomingId })
        .expect(409);
      expect(response.body.messageKey).toBe('assignment.teacherConflict');

      // Nothing moved — the outgoing teacher still holds everything.
      const held = await http()
        .get(`/api/teachers/${outgoingId}/commitments`)
        .set(auth(token))
        .expect(200);
      expect(held.body.assignments).toHaveLength(1);
      expect(held.body.homerooms).toHaveLength(1);

      // Out of the way for the tests below.
      await http()
        .patch(`/api/teaching-assignments/${clash.body.id}`)
        .set(auth(token))
        .send({ isActive: false })
        .expect(200);
    });

    it('moves the lesson, the homeroom and the status in one go', async () => {
      const response = await http()
        .post(`/api/teachers/${outgoingId}/handover`)
        .set(auth(token))
        .send({ toTeacherId: incomingId, note: 'ຄູລາອອກກາງເທີມ' })
        .expect(201);

      expect(response.body).toMatchObject({
        assignmentsMoved: 1,
        homeroomsMoved: 1,
        subjectGroupsMoved: 0,
        resigned: true,
      });

      // The old lesson is closed, not rewritten: every coverage and punctuality
      // figure is derived per day from the assignment's teacher, so editing it
      // would hand the incoming teacher a term of somebody else's gaps.
      const old = await http()
        .get(`/api/teaching-assignments/${handoverLessonId}`)
        .set(auth(token))
        .expect(200);
      expect(old.body.isActive).toBe(false);
      expect(refId(old.body.teacherId)).toBe(outgoingId);

      // And it reopens under the incoming teacher with the same periods.
      const theirs = await http()
        .get(`/api/teaching-assignments?teacherId=${incomingId}&classroomId=${handoverRoomId}`)
        .set(auth(token))
        .expect(200);
      expect(theirs.body.data).toHaveLength(1);
      expect(theirs.body.data[0]).toMatchObject({
        isActive: true,
        schedule: [expect.objectContaining({ dayOfWeek: 2, startTime: '15:10', room: 'R200' })],
      });

      const room = await http()
        .get(`/api/classrooms/${handoverRoomId}`)
        .set(auth(token))
        .expect(200);
      expect(refId(room.body.homeroomTeacherId)).toBe(incomingId);

      const outgoing = await http().get(`/api/teachers/${outgoingId}`).set(auth(token)).expect(200);
      expect(outgoing.body.status).toBe('resigned');
    });

    it('leaves a readable trail of who held the room and when', async () => {
      const room = await http()
        .get(`/api/classrooms/${handoverRoomId}`)
        .set(auth(token))
        .expect(200);

      // Two spells: the outgoing teacher's, now closed, and the incoming one's,
      // still open. A room that went weeks without a ຄູປະຈຳຫ້ອງ used to be
      // indistinguishable afterwards from one whose teacher never reviewed it.
      const history = room.body.homeroomHistory as {
        teacherId: unknown;
        from: string;
        to: string | null;
        note: string | null;
      }[];
      expect(history).toHaveLength(2);
      expect(refId(history[0].teacherId)).toBe(outgoingId);
      expect(history[0].to).not.toBeNull();
      expect(refId(history[1].teacherId)).toBe(incomingId);
      expect(history[1].to).toBeNull();
      expect(history[1].note).toBe('ຄູລາອອກກາງເທີມ');
      // The spells meet exactly, so a question about any day lands in one of them.
      expect(history[0].to).toBe(history[1].from);
    });

    it('lets the office delete the teacher once nothing is theirs', async () => {
      const held = await http()
        .get(`/api/teachers/${outgoingId}/commitments`)
        .set(auth(token))
        .expect(200);
      expect(held.body).toMatchObject({ assignments: [], homerooms: [], subjectGroups: [] });

      await http().delete(`/api/teachers/${outgoingId}`).set(auth(token)).expect(204);
    });

    it('refuses a handover with nothing left to hand over', async () => {
      const spare = await makeTeacher('ຜູ້ຫວ່າງ');

      const response = await http()
        .post(`/api/teachers/${spare}/handover`)
        .set(auth(token))
        .send({ toTeacherId: incomingId })
        .expect(400);

      expect(response.body.messageKey).toBe('teacher.nothingToHandOver');
    });
  });

  describe('homeroom monthly report — written, sent, and tracked', () => {
    let studentId: string;
    let year: number;
    let month: number;
    const report = () => ({ classroomId: secondClassroomId, month });

    beforeAll(async () => {
      // The room needs a homeroom teacher to credit the report to.
      await http()
        .patch(`/api/classrooms/${secondClassroomId}`)
        .set(auth(token))
        .send({ homeroomTeacherId: teacherId })
        .expect(200);

      studentId = await createStudent('MR-0001', 'ມະນີວອນ');
      await http()
        .post('/api/enrollments')
        .set(auth(token))
        .send({ studentId, classroomId: secondClassroomId })
        .expect(201);

      // The seeded term is in the past, so its first month's report is long overdue.
      const semester = await http().get('/api/semesters/active').set(auth(token)).expect(200);
      const start = new Date(semester.body.startDate);
      year = start.getUTCFullYear();
      month = start.getUTCMonth() + 1;
    });

    it('starts as nothing written and overdue', async () => {
      const response = await http()
        .get('/api/homeroom-reviews/monthly-report')
        .query(report())
        .set(auth(token))
        .expect(200);

      expect(response.body.entry).toMatchObject({ overview: null, extraClasses: [] });
      expect(response.body.submission).toMatchObject({
        status: 'missing',
        hasDraft: false,
        canSubmit: true,
        dueDate: new Date(Date.UTC(year, month, 5)).toISOString().slice(0, 10),
      });
      expect(response.body.isSnapshot).toBe(false);
    });

    it('saves a draft without sending it', async () => {
      const response = await http()
        .put('/api/homeroom-reviews/monthly-report')
        .set(auth(token))
        .send({
          ...report(),
          overview: 'ຫ້ອງຮຽນດີ',
          extraClasses: [{ studentId, subject: 'ພາສາອັງກິດ', teacherName: 'ອຈ ສົມພອນ' }],
          outsideActivities: [
            {
              studentId,
              date: `${year}-${String(month).padStart(2, '0')}-15`,
              detail: 'ແຂ່ງຂັນກິລາ',
            },
          ],
          suggestions: '',
        })
        .expect(200);

      expect(response.body.entry.overview).toBe('ຫ້ອງຮຽນດີ');
      expect(response.body.entry.extraClasses[0]).toMatchObject({
        studentId,
        studentNameLo: expect.stringContaining('ມະນີວອນ'),
        subject: 'ພາສາອັງກິດ',
      });
      expect(response.body.entry.suggestions).toBeNull();
      expect(response.body.submission).toMatchObject({ status: 'missing', hasDraft: true });
    });

    it('prints a picked subject and teacher by their names on file, and keeps added contacts', async () => {
      const [subject, teacher] = await Promise.all([
        http().get(`/api/subjects/${mathSubjectId}`).set(auth(token)).expect(200),
        http().get(`/api/teachers/${teacherId}`).set(auth(token)).expect(200),
      ]);
      const date = `${year}-${String(month).padStart(2, '0')}-20`;

      const response = await http()
        .put('/api/homeroom-reviews/monthly-report')
        .set(auth(token))
        .send({
          ...report(),
          extraClasses: [{ studentId, subjectId: mathSubjectId, teacherId }],
          outsideActivities: [],
          guardianContacts: [{ studentId, date, content: 'ໂທແຈ້ງເລື່ອງການບ້ານ' }],
        })
        .expect(200);

      expect(response.body.entry.extraClasses[0]).toMatchObject({
        subjectId: mathSubjectId,
        subject: subject.body.nameLo,
        teacherId,
        teacherName: `${teacher.body.firstNameLo} ${teacher.body.lastNameLo}`,
      });
      expect(response.body.entry.guardianContacts).toEqual([
        {
          studentId,
          allStudents: false,
          studentNameLo: expect.stringContaining('ມະນີວອນ'),
          date,
          content: 'ໂທແຈ້ງເລື່ອງການບ້ານ',
        },
      ]);
    });

    it('records one contact for every guardian in the room', async () => {
      const date = `${year}-${String(month).padStart(2, '0')}-21`;
      const response = await http()
        .put('/api/homeroom-reviews/monthly-report')
        .set(auth(token))
        .send({
          ...report(),
          extraClasses: [],
          outsideActivities: [],
          guardianContacts: [{ allStudents: true, date, content: 'ເຊີນປະຊຸມຜູ້ປົກຄອງ' }],
        })
        .expect(200);

      expect(response.body.entry.guardianContacts).toEqual([
        {
          studentId: null,
          allStudents: true,
          studentNameLo: 'ນັກຮຽນທັງໝົດ',
          date,
          content: 'ເຊີນປະຊຸມຜູ້ປົກຄອງ',
        },
      ]);

      // Neither a child nor the whole class is not a contact.
      await http()
        .put('/api/homeroom-reviews/monthly-report')
        .set(auth(token))
        .send({
          ...report(),
          extraClasses: [],
          outsideActivities: [],
          guardianContacts: [{ date, content: 'ບໍ່ມີຊື່' }],
        })
        .expect(400);
    });

    it('refuses an extra class with no subject', async () => {
      const response = await http()
        .put('/api/homeroom-reviews/monthly-report')
        .set(auth(token))
        .send({ ...report(), extraClasses: [{ studentId, teacherId }], outsideActivities: [] })
        .expect(400);

      expect(response.body.messageKey).toBe('homeroomReview.extraClassSubjectRequired');
    });

    it('marks a report sent after the 5th as late, and keeps the mark on a resend', async () => {
      const sent = await http()
        .post('/api/homeroom-reviews/monthly-report/submit')
        .set(auth(token))
        .send({ ...report(), overview: 'ຫ້ອງຮຽນດີ', extraClasses: [], outsideActivities: [] })
        .expect(201);

      expect(sent.body.submission.status).toBe('late');
      expect(sent.body.submission.daysLate).toBeGreaterThan(0);
      expect(sent.body.isSnapshot).toBe(true);
      const first = sent.body.submission.firstSubmittedAt;

      const resent = await http()
        .post('/api/homeroom-reviews/monthly-report/submit')
        .set(auth(token))
        .send({ ...report(), overview: 'ແກ້ໄຂ', extraClasses: [], outsideActivities: [] })
        .expect(201);

      expect(resent.body.submission).toMatchObject({ status: 'late', firstSubmittedAt: first });
      expect(resent.body.entry.overview).toBe('ແກ້ໄຂ');
    });

    it('shows the office which room sent it, and when', async () => {
      const response = await http()
        .get('/api/homeroom-reviews/monthly-report/compliance')
        .set(auth(token))
        .expect(200);

      const row = response.body.rows.find(
        (candidate: { classroomId: string }) => candidate.classroomId === secondClassroomId,
      );
      const cell = row.cells.find(
        (candidate: { year: number; month: number }) =>
          candidate.year === year && candidate.month === month,
      );
      expect(cell).toMatchObject({ status: 'late' });
      expect(cell.firstSubmittedAt).not.toBeNull();
      expect(response.body.summary.late).toBeGreaterThanOrEqual(1);
    });

    it('refuses a row naming a child who is not in the room', async () => {
      const outsider = await createStudent('MR-0002', 'ນອກຫ້ອງ');
      const response = await http()
        .put('/api/homeroom-reviews/monthly-report')
        .set(auth(token))
        .send({
          ...report(),
          extraClasses: [{ studentId: outsider, subject: 'ຄະນິດ' }],
          outsideActivities: [],
        })
        .expect(400);

      expect(response.body.messageKey).toBe('homeroomReview.studentNotOnRoll');
    });
  });

  describe('library — counts, titles, loans and workbook sales', () => {
    let grades: { id: string; code: string }[];
    const gradeId = (code: string) => grades.find((grade) => grade.code === code)!.id;

    beforeAll(async () => {
      const response = await http()
        .get('/api/library/counts')
        .query({ category: 'teacher_guide' })
        .set(auth(token))
        .expect(200);
      grades = response.body.grades;
    });

    it('stores a ຄູ່ມືຄູ sheet and works out every total itself', async () => {
      const response = await http()
        .put('/api/library/counts')
        .set(auth(token))
        .send({
          category: 'teacher_guide',
          rows: [
            {
              name: 'ວິຊາ ພາສາລາວ',
              counts: [
                { gradeLevelId: gradeId('m1'), quantity: 4 },
                { gradeLevelId: gradeId('m7'), quantity: 4 },
              ],
            },
            { name: 'ວິຊາ ຊີວະສາດ', counts: [{ gradeLevelId: gradeId('m7'), quantity: 3 }] },
          ],
        })
        .expect(200);

      expect(response.body.rows).toHaveLength(2);
      expect(response.body.totals.rowTotals).toEqual([8, 3]);
      expect(response.body.totals.columnTotals[gradeId('m7')]).toBe(7);
      expect(response.body.totals.grandTotal).toBe(11);

      // The ແບບຮຽນ sheet is a separate one and stays empty.
      const textbooks = await http()
        .get('/api/library/counts')
        .query({ category: 'textbook' })
        .set(auth(token))
        .expect(200);
      expect(textbooks.body.rows).toEqual([]);
    });

    it('lends a donated title, refuses to over-lend it, and takes it back', async () => {
      const title = await http()
        .post('/api/library/titles')
        .set(auth(token))
        .send({
          category: 'donated',
          title: 'ຈຸດຈົບຢູ່ຜາຖີ່',
          quantity: 4,
          unitPrice: 85000,
          source: 'Book Festival 2026',
        })
        .expect(201);
      expect(title.body).toMatchObject({ value: 340000, onLoan: 0, available: 4 });

      const loan = await http()
        .post('/api/library/loans')
        .set(auth(token))
        .send({
          bookTitleId: title.body.id,
          borrowerType: 'teacher',
          teacherId,
          quantity: 3,
          loanedOn: '2026-10-01',
        })
        .expect(201);
      expect(loan.body.borrowerName).toBeTruthy();

      const tooMany = await http()
        .post('/api/library/loans')
        .set(auth(token))
        .send({
          bookTitleId: title.body.id,
          borrowerType: 'other',
          borrowerName: 'ສົມເພັດ',
          quantity: 2,
          loanedOn: '2026-10-02',
        })
        .expect(400);
      expect(tooMany.body.messageKey).toBe('library.notEnoughCopies');

      const listed = await http()
        .get('/api/library/titles')
        .query({ category: 'donated', onLoan: true })
        .set(auth(token))
        .expect(200);
      expect(listed.body.data).toEqual([
        expect.objectContaining({ id: title.body.id, onLoan: 3, available: 1 }),
      ]);

      // Not while copies are out, and not cut below the copies that are out.
      await http().delete(`/api/library/titles/${title.body.id}`).set(auth(token)).expect(409);
      const cut = await http()
        .patch(`/api/library/titles/${title.body.id}`)
        .set(auth(token))
        .send({ quantity: 2 })
        .expect(400);
      expect(cut.body.messageKey).toBe('library.quantityBelowLoans');

      const returned = await http()
        .post(`/api/library/loans/${loan.body.id}/return`)
        .set(auth(token))
        .send({ returnedOn: '2026-10-10' })
        .expect(201);
      expect(returned.body.returnedOn).toBe('2026-10-10');
      await http()
        .post(`/api/library/loans/${loan.body.id}/return`)
        .set(auth(token))
        .send({})
        .expect(409);

      const summary = await http()
        .get('/api/library/titles/summary')
        .query({ category: 'donated' })
        .set(auth(token))
        .expect(200);
      expect(summary.body).toMatchObject({ copies: 4, value: 340000, onLoan: 0 });
      expect(summary.body.sources[0]).toMatchObject({ source: 'Book Festival 2026', titles: 1 });

      await http().delete(`/api/library/titles/${title.body.id}`).set(auth(token)).expect(204);
    });

    it('lends a ແບບຮຽນ by subject and grade, and holds the sheet to what is out', async () => {
      const saved = await http()
        .put('/api/library/counts')
        .set(auth(token))
        .send({
          category: 'textbook',
          rows: [{ name: 'ວິຊາ ຄະນິດສາດ', counts: [{ gradeLevelId: gradeId('m5'), quantity: 2 }] }],
        })
        .expect(200);
      const { sheetId } = saved.body;
      const { rowId } = saved.body.rows[0];

      const picker = await http()
        .get('/api/library/lendables')
        .query({ search: 'ຄະນິດ' })
        .set(auth(token))
        .expect(200);
      expect(picker.body).toContainEqual(
        expect.objectContaining({
          key: `c:${sheetId}:${rowId}:${gradeId('m5')}`,
          category: 'textbook',
          available: 2,
        }),
      );

      const lend = (quantity: number) =>
        http()
          .post('/api/library/loans')
          .set(auth(token))
          .send({
            countSheetId: sheetId,
            rowId,
            gradeLevelId: gradeId('m5'),
            borrowerType: 'teacher',
            teacherId,
            quantity,
            loanedOn: '2026-10-12',
          });
      const loan = await lend(2).expect(201);
      expect(loan.body).toMatchObject({ bookCategory: 'textbook', countSheetId: sheetId });
      expect(loan.body.bookTitle).toContain('ວິຊາ ຄະນິດສາດ');
      expect((await lend(1).expect(400)).body.messageKey).toBe('library.notEnoughCopies');

      // The sheet now shows the copies out, and cannot be cut below them —
      // nor have the row renamed out from under them.
      const sheet = await http()
        .get('/api/library/counts')
        .query({ category: 'textbook' })
        .set(auth(token))
        .expect(200);
      expect(sheet.body.rows[0].onLoan).toEqual({ [gradeId('m5')]: 2 });

      const cut = await http()
        .put('/api/library/counts')
        .set(auth(token))
        .send({
          category: 'textbook',
          rows: [
            {
              rowId,
              name: 'ວິຊາ ຄະນິດສາດ',
              counts: [{ gradeLevelId: gradeId('m5'), quantity: 1 }],
            },
          ],
        })
        .expect(400);
      expect(cut.body.messageKey).toBe('library.quantityBelowLoans');
      await http()
        .put('/api/library/counts')
        .set(auth(token))
        .send({ category: 'textbook', rows: [] })
        .expect(400);

      // Renaming keeps the loan, because it follows the row's id.
      await http()
        .put('/api/library/counts')
        .set(auth(token))
        .send({
          category: 'textbook',
          rows: [
            {
              rowId,
              name: 'ວິຊາ ຄະນິດສາດ (ສະບັບໃໝ່)',
              counts: [{ gradeLevelId: gradeId('m5'), quantity: 3 }],
            },
          ],
        })
        .expect(200);

      await http()
        .post(`/api/library/loans/${loan.body.id}/return`)
        .set(auth(token))
        .send({})
        .expect(201);
      const after = await http()
        .get('/api/library/counts')
        .query({ category: 'textbook' })
        .set(auth(token))
        .expect(200);
      expect(after.body.rows[0].onLoan).toEqual({});
    });

    it('refuses a loan that names no book, or two', async () => {
      const response = await http()
        .post('/api/library/loans')
        .set(auth(token))
        .send({ borrowerType: 'other', borrowerName: 'x', loanedOn: '2026-10-12' })
        .expect(400);
      expect(response.body.messageKey).toBe('library.loanTargetRequired');
    });

    it('totals the workbook sales the way the office’s sheet does', async () => {
      const response = await http()
        .put('/api/library/workbook-sales')
        .set(auth(token))
        .send({
          lines: [
            { gradeLevelId: gradeId('m5'), booksPerSet: 5, setsProduced: 24, pricePerSet: 170000 },
            { gradeLevelId: gradeId('m6'), booksPerSet: 5, setsProduced: 29, pricePerSet: 200000 },
            { gradeLevelId: gradeId('m7'), booksPerSet: 4, setsProduced: 17, pricePerSet: 165000 },
          ],
          extraSales: [{ description: 'ຂາຍເພີ່ມຕື່ມ', sets: 2, books: 10, amount: 340000 }],
        })
        .expect(200);

      expect(response.body.totals).toMatchObject({
        sets: 70,
        books: 333,
        amount: 12685000,
        extraSets: 2,
        extraBooks: 10,
        grandAmount: 13025000,
      });
      expect(response.body.extraSales[0]).toMatchObject({ sets: 2, books: 10 });
    });
  });
});
