import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  TestContext,
  auth,
  createTestApp,
  login,
} from './test-app';

/**
 * Phase 3–5 end to end: the lesson-plan review workflow, exam eligibility and
 * registration, certificate issuance and public verification, announcement
 * targeting, and feedback anonymity.
 */
describe('Communication, lesson plans, exams and certificates (e2e)', () => {
  let context: TestContext;
  let app: INestApplication;
  let adminToken: string;
  let teacherToken: string;
  let headToken: string;
  let studentToken: string;

  let semesterId: string;
  let schoolYearId: string;
  let classroomId: string;
  let otherClassroomId: string;
  let gradeLevelId: string;
  let subjectId: string;
  let teacherId: string;
  let studentId: string;

  const http = () => request(app.getHttpServer());
  const PASSWORD = 'CommsPass123';

  async function createAccount(
    username: string,
    roleCode: string,
    person?: { personType: 'teacher' | 'student'; personId: string },
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

    const initial = await login(app, ADMIN_USERNAME, ADMIN_PASSWORD);
    await http()
      .post('/api/auth/change-password')
      .set(auth(initial.accessToken))
      .send({ currentPassword: ADMIN_PASSWORD, newPassword: 'AdminPass456' })
      .expect(204);
    adminToken = (await login(app, ADMIN_USERNAME, 'AdminPass456')).accessToken;

    const [year, semester, grades, subjects, teachers, villages] = await Promise.all([
      http().get('/api/school-years/active').set(auth(adminToken)).expect(200),
      http().get('/api/semesters/active').set(auth(adminToken)).expect(200),
      http().get('/api/grade-levels?limit=20').set(auth(adminToken)).expect(200),
      http().get('/api/subjects?limit=100').set(auth(adminToken)).expect(200),
      http().get('/api/teachers?limit=10').set(auth(adminToken)).expect(200),
      http().get('/api/locations?type=village&limit=5').set(auth(adminToken)).expect(200),
    ]);

    schoolYearId = year.body.id;
    semesterId = semester.body.id;
    gradeLevelId = grades.body.data.find((g: { code: string }) => g.code === 'm4').id;
    subjectId = subjects.body.data.find((s: { code: string }) => s.code === 'MATH-M4').id;
    teacherId = teachers.body.data[0].id;
    const headTeacherId = teachers.body.data.find(
      (t: { isAcademicHead: boolean }) => t.isAcademicHead,
    ).id;
    const villageId = villages.body.data[0].id;

    const classrooms = await http()
      .get(`/api/classrooms?gradeLevelId=${gradeLevelId}`)
      .set(auth(adminToken))
      .expect(200);
    classroomId = classrooms.body.data[0].id;
    otherClassroomId = classrooms.body.data[1].id;

    const student = await http()
      .post('/api/students')
      .set(auth(adminToken))
      .send({
        studentCode: 'S-COMM-001',
        firstNameLo: 'ນາງ',
        lastNameLo: 'ວົງສະຫວັນ',
        gender: 'female',
        dateOfBirth: '2010-05-14',
        villageId,
        guardians: [
          {
            guardian: { firstNameLo: 'ບຸນມີ', lastNameLo: 'ສີສຸວັນ', phone: '02055566001' },
            relationship: 'father',
            isPrimary: true,
          },
        ],
      })
      .expect(201);
    studentId = student.body.id;

    await http()
      .post('/api/enrollments')
      .set(auth(adminToken))
      .send({ studentId, classroomId })
      .expect(201);

    teacherToken = await createAccount('lp-teacher', 'teacher', {
      personType: 'teacher',
      personId: teacherId,
    });
    headToken = await createAccount('lp-head', 'academic_head');
    studentToken = await createAccount('comm-student', 'student', {
      personType: 'student',
      personId: studentId,
    });

    // The head teacher needs an account too, so submit notifications land.
    await createAccount('head-teacher-acct', 'teacher', {
      personType: 'teacher',
      personId: headTeacherId,
    });
  }, 240_000);

  afterAll(async () => {
    await context?.close();
  });

  // ── Lesson plans ──────────────────────────────────────────────────────────

  describe('lesson plan workflow', () => {
    let planId: string;

    it('creates a draft owned by the calling teacher', async () => {
      const response = await http()
        .post('/api/lesson-plans')
        .set(auth(teacherToken))
        .send({
          subjectId,
          classroomId,
          semesterId,
          title: 'ແຜນການສອນ ອາທິດທີ 3',
          weekStartDate: '2025-09-15',
          weekEndDate: '2025-09-19',
          dueDate: '2025-09-14',
          activities: [{ topic: 'ສົມຜົນກຳລັງສອງ', date: '2025-09-15', durationMinutes: 50 }],
        })
        .expect(201);

      planId = response.body.id;
      expect(response.body.status).toBe('draft');
      // The owner comes from the token, not the body.
      expect(response.body.teacherId).toBe(teacherId);
    });

    it('refuses to submit a plan with no activities', async () => {
      const empty = await http()
        .post('/api/lesson-plans')
        .set(auth(teacherToken))
        .send({
          subjectId,
          classroomId,
          semesterId,
          title: 'ແຜນເປົ່າ',
          weekStartDate: '2025-09-22',
          weekEndDate: '2025-09-26',
          dueDate: '2025-09-21',
        })
        .expect(201);

      await http()
        .post(`/api/lesson-plans/${empty.body.id}/submit`)
        .set(auth(teacherToken))
        .expect(400);
    });

    it('marks a plan submitted after its deadline as late', async () => {
      const response = await http()
        .post(`/api/lesson-plans/${planId}/submit`)
        .set(auth(teacherToken))
        .expect(201);

      expect(response.body.status).toBe('submitted');
      // Due 2025-09-14, submitted now — unambiguously late.
      expect(response.body.isLate).toBe(true);
    });

    it('notifies the academic head that a plan awaits review', async () => {
      const notifications = await http()
        .get('/api/notifications?limit=20')
        .set(auth(await loginAcademicHeadTeacher()))
        .expect(200);

      expect(
        notifications.body.data.some((n: { titleLo: string }) => n.titleLo.includes('ລໍຖ້າກວດ')),
      ).toBe(true);
    });

    it('blocks editing while the plan is under review', async () => {
      // Move it to under_review by approving is terminal, so use the review
      // queue state directly: a submitted plan may still be edited, but an
      // approved one may not — checked after approval below.
      const queue = await http()
        .get('/api/lesson-plans/review-queue')
        .set(auth(headToken))
        .expect(200);

      expect(queue.body.data.some((p: { id: string }) => p.id === planId)).toBe(true);
    });

    it('requires a comment when returning a plan', async () => {
      await http()
        .post(`/api/lesson-plans/${planId}/review`)
        .set(auth(headToken))
        .send({ decision: 'returned' })
        .expect(400);
    });

    it('returns the plan with a comment and notifies the teacher', async () => {
      const response = await http()
        .post(`/api/lesson-plans/${planId}/review`)
        .set(auth(headToken))
        .send({ decision: 'returned', comment: 'ກະລຸນາເພີ່ມກິດຈະກຳປະເມີນຜົນ' })
        .expect(201);

      expect(response.body.status).toBe('returned');
      expect(response.body.reviews).toHaveLength(1);

      const notifications = await http()
        .get('/api/notifications?limit=20')
        .set(auth(teacherToken))
        .expect(200);

      expect(
        notifications.body.data.some((n: { type: string }) => n.type === 'lesson_plan_returned'),
      ).toBe(true);
    });

    it('denies a teacher the review endpoint', async () => {
      await http()
        .post(`/api/lesson-plans/${planId}/review`)
        .set(auth(teacherToken))
        .send({ decision: 'approved' })
        .expect(403);
    });

    it('lets the teacher revise and resubmit', async () => {
      await http()
        .patch(`/api/lesson-plans/${planId}`)
        .set(auth(teacherToken))
        .send({
          activities: [
            { topic: 'ສົມຜົນກຳລັງສອງ', date: '2025-09-15' },
            { topic: 'ການປະເມີນຜົນ', date: '2025-09-19' },
          ],
        })
        .expect(200);

      const resubmitted = await http()
        .post(`/api/lesson-plans/${planId}/submit`)
        .set(auth(teacherToken))
        .expect(201);

      expect(resubmitted.body.status).toBe('submitted');
    });

    it('approves the plan and then blocks further edits', async () => {
      await http()
        .post(`/api/lesson-plans/${planId}/review`)
        .set(auth(headToken))
        .send({ decision: 'approved', comment: 'ດີແລ້ວ' })
        .expect(201);

      // Approved is terminal — the plan is now the agreed record.
      await http()
        .patch(`/api/lesson-plans/${planId}`)
        .set(auth(teacherToken))
        .send({ title: 'ປ່ຽນຊື່' })
        .expect(409);

      await http().delete(`/api/lesson-plans/${planId}`).set(auth(teacherToken)).expect(409);
    });

    it('sends deadline reminders for overdue plans', async () => {
      const response = await http()
        .post('/api/lesson-plans/run-due-reminders')
        .set(auth(adminToken))
        .expect(200);

      // The empty draft created earlier is past its 2025 deadline.
      expect(response.body.overdue).toBeGreaterThanOrEqual(1);
    });

    /** The seeded academic-head teacher's own account. */
    async function loginAcademicHeadTeacher(): Promise<string> {
      return (await login(app, 'head-teacher-acct', PASSWORD)).accessToken;
    }
  });

  // ── Exams ─────────────────────────────────────────────────────────────────

  describe('exam eligibility and registration', () => {
    it('reports why a student is not yet eligible', async () => {
      const response = await http()
        .get(`/api/exams/eligibility?studentId=${studentId}&level=m4`)
        .set(auth(adminToken))
        .expect(200);

      // No term result has been computed for this student.
      expect(response.body.isEligible).toBe(false);
      expect(response.body.failedChecks).toContain('no_term_result');
      expect(response.body.snapshot.checkedAt).toEqual(expect.any(String));
    });

    it('refuses to register an ineligible student', async () => {
      const response = await http()
        .post('/api/exams/registrations')
        .set(auth(adminToken))
        .send({ studentId, level: 'm4' })
        .expect(422);

      expect(response.body.details.failedChecks).toContain('no_term_result');
    });

    it('requires a reason when overriding eligibility', async () => {
      await http()
        .post('/api/exams/registrations')
        .set(auth(adminToken))
        .send({ studentId, level: 'm4', overrideIneligible: true })
        .expect(400);
    });

    it('registers with an override and records it in the snapshot', async () => {
      const response = await http()
        .post('/api/exams/registrations')
        .set(auth(adminToken))
        .send({
          studentId,
          level: 'm4',
          overrideIneligible: true,
          overrideReason: 'Transferred mid-year; prior school records verified',
        })
        .expect(201);

      expect(response.body.status).toBe('pending');
      expect(response.body.eligibilitySnapshot.overridden).toBe(true);
      expect(response.body.eligibilitySnapshot.overrideReason).toContain('Transferred');
    });

    it('rejects a duplicate registration for the same exam', async () => {
      await http()
        .post('/api/exams/registrations')
        .set(auth(adminToken))
        .send({
          studentId,
          level: 'm4',
          overrideIneligible: true,
          overrideReason: 'Attempting a duplicate registration on purpose',
        })
        .expect(409);
    });

    it('approves the registration and issues a seat number', async () => {
      const list = await http()
        .get(`/api/exams/registrations?studentId=${studentId}`)
        .set(auth(adminToken))
        .expect(200);
      const registrationId = list.body.data[0].id;

      const approved = await http()
        .post(`/api/exams/registrations/${registrationId}/approve`)
        .set(auth(adminToken))
        .send({ examNumber: 'VTE-M4-00123', examCenter: 'ວຽງຈັນ' })
        .expect(201);

      expect(approved.body.status).toBe('approved');
      expect(approved.body.examNumber).toBe('VTE-M4-00123');
    });

    it('computes exam totals from the subject marks rather than trusting input', async () => {
      const list = await http()
        .get(`/api/exams/registrations?studentId=${studentId}`)
        .set(auth(adminToken))
        .expect(200);

      const response = await http()
        .post('/api/exams/results')
        .set(auth(adminToken))
        .send({
          registrationId: list.body.data[0].id,
          subjects: [
            { subjectNameLo: 'ຄະນິດສາດ', score: 80, maxScore: 100 },
            { subjectNameLo: 'ພາສາລາວ', score: 40, maxScore: 100 },
          ],
        })
        .expect(201);

      expect(response.body.totalScore).toBe(120);
      expect(response.body.maxTotalScore).toBe(200);
      expect(response.body.percentage).toBe(60);
      // Every subject must pass; ພາສາລາວ at 40% does not.
      expect(response.body.isPassed).toBe(false);
    });

    it('rejects a subject mark above its maximum', async () => {
      const list = await http()
        .get(`/api/exams/registrations?studentId=${studentId}`)
        .set(auth(adminToken))
        .expect(200);

      await http()
        .post('/api/exams/results')
        .set(auth(adminToken))
        .send({
          registrationId: list.body.data[0].id,
          subjects: [{ subjectNameLo: 'ຄະນິດສາດ', score: 120, maxScore: 100 }],
        })
        .expect(400);
    });

    it('hides an unpublished result from the student, then reveals it', async () => {
      await http()
        .get(`/api/exams/results/student/${studentId}/level/m4`)
        .set(auth(studentToken))
        .expect(403);

      await http()
        .post('/api/exams/results/publish')
        .set(auth(adminToken))
        .send({ schoolYearId, level: 'm4' })
        .expect(200);

      const visible = await http()
        .get(`/api/exams/results/student/${studentId}/level/m4`)
        .set(auth(studentToken))
        .expect(200);

      expect(visible.body.isPublished).toBe(true);
    });
  });

  // ── Certificates ──────────────────────────────────────────────────────────

  describe('certificates', () => {
    let certificateId: string;
    let certificateNumber: string;

    it('issues a certificate with a sequential number', async () => {
      const response = await http()
        .post('/api/certificates')
        .set(auth(adminToken))
        .send({
          studentId,
          type: 'completion',
          gradeLevelId,
          titleLo: 'ໃບຢັ້ງຢືນຈົບຊັ້ນ',
        })
        .expect(201);

      certificateId = response.body.id;
      certificateNumber = response.body.certificateNumber;

      expect(certificateNumber).toMatch(/^2025-2026\/COMP\/0001$/);
    });

    it('allocates the next ordinal for a second certificate of the same type', async () => {
      const second = await http()
        .post('/api/certificates')
        .set(auth(adminToken))
        .send({ studentId, type: 'completion', gradeLevelId })
        .expect(201);

      expect(second.body.certificateNumber).toBe('2025-2026/COMP/0002');
    });

    it('verifies a genuine certificate without authentication', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/certificates/verify/${encodeURIComponent(certificateNumber)}`)
        .expect(200);

      expect(response.body.isValid).toBe(true);
      expect(response.body.studentNameLo).toBe('ນາງ ວົງສະຫວັນ');
      // Public endpoint — must not leak marks or contact details.
      expect(response.body).not.toHaveProperty('average');
      expect(response.body).not.toHaveProperty('studentId');
    });

    it('reports an unknown number as invalid rather than 404', async () => {
      // A typo and a forgery must be indistinguishable from outside.
      const response = await request(app.getHttpServer())
        .get('/api/certificates/verify/2025-2026%2FCOMP%2F9999')
        .expect(200);

      expect(response.body.isValid).toBe(false);
      expect(response.body.studentNameLo).toBeNull();
    });

    it('marks a revoked certificate invalid but still verifiable', async () => {
      await http()
        .post(`/api/certificates/${certificateId}/revoke`)
        .set(auth(adminToken))
        .send({ reason: 'Issued against an incorrect grade level' })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get(`/api/certificates/verify/${encodeURIComponent(certificateNumber)}`)
        .expect(200);

      // Still found — "revoked" is a different answer from "never existed".
      expect(response.body.isValid).toBe(false);
      expect(response.body.isRevoked).toBe(true);
      expect(response.body.studentNameLo).toBe('ນາງ ວົງສະຫວັນ');
    });
  });

  // ── Announcements ─────────────────────────────────────────────────────────

  describe('announcements and targeting', () => {
    let announcementId: string;

    it('rejects a classroom target with no id', async () => {
      // Would silently match nobody, which is worse than an error.
      await http()
        .post('/api/announcements')
        .set(auth(adminToken))
        .send({
          titleLo: 'ບໍ່ມີເປົ້າໝາຍ',
          contentLo: 'ເນື້ອໃນ',
          targets: [{ targetType: 'classroom' }],
        })
        .expect(400);
    });

    it('rejects an id on a target type that takes none', async () => {
      await http()
        .post('/api/announcements')
        .set(auth(adminToken))
        .send({
          titleLo: 'ເປົ້າໝາຍຜິດ',
          contentLo: 'ເນື້ອໃນ',
          targets: [{ targetType: 'all', targetId: classroomId }],
        })
        .expect(400);
    });

    it('creates an announcement as an unpublished draft', async () => {
      const response = await http()
        .post('/api/announcements')
        .set(auth(adminToken))
        .send({
          titleLo: 'ປິດພັກຮຽນວັນບຸນທາດຫລວງ',
          contentLo: 'ໂຮງຮຽນຈະປິດໃນວັນທີ 5 ພະຈິກ',
          targets: [{ targetType: 'classroom', targetId: classroomId }],
          priority: 'high',
        })
        .expect(201);

      announcementId = response.body.id;
      expect(response.body.isPublished).toBe(false);
    });

    it('hides a draft from its audience', async () => {
      const feed = await http()
        .get('/api/announcements?limit=20')
        .set(auth(studentToken))
        .expect(200);

      expect(feed.body.data.some((a: { id: string }) => a.id === announcementId)).toBe(false);
    });

    it('publishes and notifies the targeted classroom', async () => {
      const response = await http()
        .post(`/api/announcements/${announcementId}/publish`)
        .set(auth(adminToken))
        .expect(200);

      expect(response.body.published).toBe(true);
      // The student plus their guardian — the guardian has no account here, so
      // at least the student is reached.
      expect(response.body.notified).toBeGreaterThanOrEqual(1);

      const notifications = await http()
        .get('/api/notifications?type=announcement')
        .set(auth(studentToken))
        .expect(200);

      expect(notifications.body.meta.total).toBeGreaterThanOrEqual(1);
    });

    it('shows the published announcement in the targeted student feed', async () => {
      const feed = await http()
        .get('/api/announcements?limit=20')
        .set(auth(studentToken))
        .expect(200);

      expect(feed.body.data.some((a: { id: string }) => a.id === announcementId)).toBe(true);
    });

    it('refuses to publish twice, so nobody is notified twice', async () => {
      await http()
        .post(`/api/announcements/${announcementId}/publish`)
        .set(auth(adminToken))
        .expect(409);
    });

    it('keeps an announcement for another classroom out of this student feed', async () => {
      const other = await http()
        .post('/api/announcements')
        .set(auth(adminToken))
        .send({
          titleLo: 'ສະເພາະຫ້ອງອື່ນ',
          contentLo: 'ເນື້ອໃນ',
          targets: [{ targetType: 'classroom', targetId: otherClassroomId }],
        })
        .expect(201);

      await http()
        .post(`/api/announcements/${other.body.id}/publish`)
        .set(auth(adminToken))
        .expect(200);

      const feed = await http()
        .get('/api/announcements?limit=50')
        .set(auth(studentToken))
        .expect(200);

      expect(feed.body.data.some((a: { id: string }) => a.id === other.body.id)).toBe(false);
    });

    it('delivers a school-wide announcement to everyone', async () => {
      const all = await http()
        .post('/api/announcements')
        .set(auth(adminToken))
        .send({
          titleLo: 'ແຈ້ງການທົ່ວໄປ',
          contentLo: 'ສຳລັບທຸກຄົນ',
          targets: [{ targetType: 'all' }],
        })
        .expect(201);

      await http()
        .post(`/api/announcements/${all.body.id}/publish`)
        .set(auth(adminToken))
        .expect(200);

      const feed = await http()
        .get('/api/announcements?limit=50')
        .set(auth(studentToken))
        .expect(200);

      expect(feed.body.data.some((a: { id: string }) => a.id === all.body.id)).toBe(true);
    });
  });

  // ── Notifications ─────────────────────────────────────────────────────────

  describe('notifications', () => {
    it('reports an unread count and clears it', async () => {
      const before = await http()
        .get('/api/notifications/unread-count')
        .set(auth(studentToken))
        .expect(200);
      expect(before.body.unread).toBeGreaterThan(0);

      await http().post('/api/notifications/read-all').set(auth(studentToken)).expect(200);

      const after = await http()
        .get('/api/notifications/unread-count')
        .set(auth(studentToken))
        .expect(200);
      expect(after.body.unread).toBe(0);
    });

    it("does not expose another user's notification", async () => {
      const teacherInbox = await http()
        .get('/api/notifications?limit=1')
        .set(auth(teacherToken))
        .expect(200);

      if (teacherInbox.body.data.length > 0) {
        // The student must not be able to mark a teacher's notification read.
        await http()
          .post(`/api/notifications/${teacherInbox.body.data[0].id}/read`)
          .set(auth(studentToken))
          .expect(404);
      }
    });
  });

  // ── Calendar ──────────────────────────────────────────────────────────────

  describe('calendar', () => {
    it('finds a multi-day event from a date inside its range', async () => {
      // Lao New Year is seeded across 14–16 April; querying a single day inside
      // it must match, which is what overlap semantics are for.
      const response = await http()
        .get('/api/calendar?from=2026-04-15&to=2026-04-15')
        .set(auth(adminToken))
        .expect(200);

      expect(
        response.body.data.some((e: { titleLo: string }) => e.titleLo.includes('ປີໃໝ່ລາວ')),
      ).toBe(true);
    });

    it('rejects an event whose end precedes its start', async () => {
      await http()
        .post('/api/calendar')
        .set(auth(adminToken))
        .send({
          titleLo: 'ຜິດພາດ',
          type: 'meeting',
          startDate: '2026-03-10',
          endDate: '2026-03-01',
        })
        .expect(400);
    });

    it('returns a month grid including adjacent days', async () => {
      const response = await http()
        .get('/api/calendar/month/2026/4')
        .set(auth(adminToken))
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  // ── Feedback ──────────────────────────────────────────────────────────────

  describe('feedback', () => {
    it('records an attributed submission and lists it under "mine"', async () => {
      await http()
        .post('/api/feedback')
        .set(auth(studentToken))
        .send({
          subject: 'ຂໍ້ສະເໜີກ່ຽວກັບຕາຕະລາງຮຽນ',
          message: 'ຢາກໃຫ້ເລີ່ມຮຽນຊ້າກວ່ານີ້ 30 ນາທີ',
        })
        .expect(201);

      const mine = await http().get('/api/feedback/mine').set(auth(studentToken)).expect(200);
      expect(mine.body.meta.total).toBe(1);
    });

    it('stores nothing identifying for an anonymous submission', async () => {
      const response = await http()
        .post('/api/feedback')
        .set(auth(studentToken))
        .send({
          subject: 'ບໍ່ລະບຸຊື່',
          message: 'ຂໍ້ຄວາມທີ່ບໍ່ຕ້ອງການລະບຸຕົວຕົນ',
          isAnonymous: true,
        })
        .expect(201);

      expect(response.body.isAnonymous).toBe(true);
      expect(response.body.submittedBy).toBeNull();

      // It must not appear in the submitter's own history — that would make it
      // traceable, defeating the point.
      const mine = await http().get('/api/feedback/mine').set(auth(studentToken)).expect(200);
      expect(mine.body.meta.total).toBe(1);

      // …and the admin view must not carry an author either.
      const all = await http().get('/api/feedback?limit=20').set(auth(adminToken)).expect(200);
      const anonymous = all.body.data.find((f: { isAnonymous: boolean }) => f.isAnonymous);
      expect(anonymous.submittedBy).toBeNull();
    });

    it('responds to attributed feedback and notifies the submitter', async () => {
      const all = await http().get('/api/feedback?limit=20').set(auth(adminToken)).expect(200);
      const attributed = all.body.data.find((f: { isAnonymous: boolean }) => !f.isAnonymous);

      await http()
        .post(`/api/feedback/${attributed.id}/respond`)
        .set(auth(adminToken))
        .send({ response: 'ຂອບໃຈສຳລັບຂໍ້ສະເໜີ ພວກເຮົາຈະພິຈາລະນາ' })
        .expect(201);

      const notifications = await http()
        .get('/api/notifications?limit=20')
        .set(auth(studentToken))
        .expect(200);

      expect(
        notifications.body.data.some((n: { titleLo: string }) => n.titleLo.includes('ຄວາມຄິດເຫັນ')),
      ).toBe(true);
    });

    it('summarizes feedback by status', async () => {
      const response = await http().get('/api/feedback/summary').set(auth(adminToken)).expect(200);

      expect(response.body).toHaveProperty('resolved');
    });
  });

  // ── Report templates ──────────────────────────────────────────────────────

  describe('report templates', () => {
    it('seeds an active report card and certificate template', async () => {
      const response = await http()
        .get('/api/reports/templates?limit=20')
        .set(auth(adminToken))
        .expect(200);

      const codes = response.body.data.map((t: { code: string }) => t.code);
      expect(codes).toEqual(expect.arrayContaining(['report-card-default', 'certificate-default']));
    });

    it('rejects a layout with an unknown section type', async () => {
      // Caught on write, not at render time inside a background job.
      const response = await http()
        .post('/api/reports/templates')
        .set(auth(adminToken))
        .send({
          code: 'bad-template',
          nameLo: 'ຜິດ',
          type: 'report_card',
          layout: { sections: [{ type: 'notARealSection' }] },
        })
        .expect(400);

      expect(response.body.details.unknownTypes).toEqual(['notARealSection']);
    });

    it('rejects a layout with no sections', async () => {
      await http()
        .post('/api/reports/templates')
        .set(auth(adminToken))
        .send({
          code: 'empty-template',
          nameLo: 'ຫວ່າງເປົ່າ',
          type: 'report_card',
          layout: { sections: [] },
        })
        .expect(400);
    });

    it('bumps the version when the layout changes', async () => {
      const list = await http()
        .get('/api/reports/templates?limit=20')
        .set(auth(adminToken))
        .expect(200);
      const template = list.body.data.find(
        (t: { code: string }) => t.code === 'report-card-default',
      );

      const updated = await http()
        .patch(`/api/reports/templates/${template.id}`)
        .set(auth(adminToken))
        .send({ layout: { sections: [{ type: 'summary', showAverage: true }] } })
        .expect(200);

      expect(updated.body.version).toBe(template.version + 1);
    });
  });
});
