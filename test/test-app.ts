import { CacheModule } from '@nestjs/cache-manager';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { AllExceptionsFilter } from 'src/common/filters/all-exceptions.filter';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/common/guards/permissions.guard';
import { I18nModule } from 'src/common/i18n/i18n.module';
import { RecordScopeModule } from 'src/common/services/record-scope.service';
import { validateEnv } from 'src/config/configuration';
import { TransactionModule } from 'src/database/transaction.module';
import { SeedModule } from 'src/database/seeds/seed.module';
import { SeedService } from 'src/database/seeds/seed.service';
import { AttendancesModule } from 'src/modules/attendances/attendances.module';
import { AuditLogsModule } from 'src/modules/audit-logs/audit-logs.module';
import { AuthModule } from 'src/modules/auth/auth.module';
import { ClassroomsModule } from 'src/modules/classrooms/classrooms.module';
import { ConductDeductionsModule } from 'src/modules/conduct-deductions/conduct-deductions.module';
import { ConductScoresModule } from 'src/modules/conduct-scores/conduct-scores.module';
import { EnrollmentsModule } from 'src/modules/enrollments/enrollments.module';
import { GradeLevelsModule } from 'src/modules/grade-levels/grade-levels.module';
import { GuardiansModule } from 'src/modules/guardians/guardians.module';
import { HealthModule } from 'src/modules/health/health.module';
import { LocationsModule } from 'src/modules/locations/locations.module';
import { RolesModule } from 'src/modules/roles/roles.module';
import { SchoolYearsModule } from 'src/modules/school-years/school-years.module';
import { ScoreComponentsModule } from 'src/modules/score-components/score-components.module';
import { ScoresModule } from 'src/modules/scores/scores.module';
import { SemestersModule } from 'src/modules/semesters/semesters.module';
import { SettingsModule } from 'src/modules/settings/settings.module';
import { StorageModule } from 'src/modules/storage/storage.module';
import { StudentsModule } from 'src/modules/students/students.module';
import { SubjectsModule } from 'src/modules/subjects/subjects.module';
import { TeachersModule } from 'src/modules/teachers/teachers.module';
import { TeachingAssignmentsModule } from 'src/modules/teaching-assignments/teaching-assignments.module';
import { MonthlyMarksModule } from 'src/modules/monthly-marks/monthly-marks.module';
import { TermResultsService } from 'src/modules/term-results/term-results.service';
import { UsersModule } from 'src/modules/users/users.module';
import { Module } from '@nestjs/common';
import { MongooseModule as MM } from '@nestjs/mongoose';
import {
  Classroom,
  ClassroomSchema,
  GeneratedReport,
  GeneratedReportSchema,
  GradeLevel,
  GradeLevelSchema,
  ReportTemplate,
  ReportTemplateSchema,
  SchoolYear,
  SchoolYearSchema,
  Semester,
  SemesterSchema,
  Student,
  StudentSchema,
  Subject,
  SubjectSchema,
  TermResult,
  TermResultSchema,
} from 'src/database/schemas';
import { AnnouncementsModule } from 'src/modules/announcements/announcements.module';
import { CalendarModule } from 'src/modules/calendar/calendar.module';
import { CertificatesModule } from 'src/modules/certificates/certificates.module';
import { DocumentsModule } from 'src/modules/documents/documents.module';
import { ExamsModule } from 'src/modules/exams/exams.module';
import { FeedbackModule } from 'src/modules/feedback/feedback.module';
import { LessonPlansModule } from 'src/modules/lesson-plans/lesson-plans.module';
import { NotificationsModule } from 'src/modules/notifications/notifications.module';
import { PdfRendererService } from 'src/modules/reports/pdf/pdf-renderer.service';
import { ReportDataService } from 'src/modules/reports/report-data.service';
import { ReportTemplatesService } from 'src/modules/reports/report-templates.service';
import { ReportsController } from 'src/modules/reports/reports.controller';
import { ReportsQueueService } from 'src/modules/reports/reports.queue';
import { StudyCertificateRenderer } from 'src/modules/reports/pdf/study-certificate.renderer';
import { ReportsModule } from 'src/modules/reports/reports.module';
import { GradingScaleModule } from 'src/modules/term-results/grading-scale.service';
import { ReportsService } from 'src/modules/reports/reports.service';
import { TermResultsController } from 'src/modules/term-results/term-results.controller';
import { TermResultsModule } from 'src/modules/term-results/term-results.module';
import { TermResultsQueueService } from 'src/modules/term-results/term-results.queue';

/**
 * Term-results module without BullMQ.
 *
 * The real module registers a queue, which needs a live Redis. Integration tests
 * exercise the computation through `compute-sync`, so the queue service is
 * replaced with a stub and no Redis is required.
 */
@Module({
  imports: [
    MM.forFeature([
      { name: TermResult.name, schema: TermResultSchema },
      { name: Subject.name, schema: SubjectSchema },
    ]),
    ScoresModule,
    EnrollmentsModule,
    ScoreComponentsModule,
    SubjectsModule,
    // The grade a class sits decides how many subjects the average divides by.
    ClassroomsModule,
    // The school's letter bands, shared with the monthly summary.
    GradingScaleModule,
    ConductScoresModule,
    AttendancesModule,
    // The term result reads the monthly marks, so the real module's dependency
    // has to be here too — the stub only stands in for the queue.
    MonthlyMarksModule,
  ],
  controllers: [TermResultsController],
  providers: [
    TermResultsService,
    {
      provide: TermResultsQueueService,
      useValue: {
        enqueueClassroom: async () => 'test-job-id',
        getJobStatus: async () => ({ jobId: 'test-job-id', state: 'completed' }),
      },
    },
  ],
})
class TestTermResultsModule {}

/**
 * Reports module without BullMQ, for the same reason as the term-results one.
 *
 * Tests exercise rendering through `POST /reports/:id/render-now`, which does
 * the same work synchronously, so no Redis is needed.
 */
@Module({
  imports: [
    MM.forFeature([
      { name: ReportTemplate.name, schema: ReportTemplateSchema },
      { name: GeneratedReport.name, schema: GeneratedReportSchema },
      { name: TermResult.name, schema: TermResultSchema },
      { name: Student.name, schema: StudentSchema },
      { name: Classroom.name, schema: ClassroomSchema },
      { name: GradeLevel.name, schema: GradeLevelSchema },
      { name: SchoolYear.name, schema: SchoolYearSchema },
      { name: Semester.name, schema: SemesterSchema },
    ]),
    AttendancesModule,
  ],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReportTemplatesService,
    ReportDataService,
    PdfRendererService,
    // `CertificatesModule` imports this module for the renderer, so a provider
    // added to the real `ReportsModule` and not mirrored here takes the whole
    // suite down at boot rather than failing one test.
    StudyCertificateRenderer,
    {
      provide: ReportsQueueService,
      useValue: {
        enqueueRender: async () => 'test-report-job',
        getJobStatus: async () => ({ jobId: 'test-report-job', state: 'completed' }),
      },
    },
  ],
  exports: [
    ReportsService,
    ReportDataService,
    PdfRendererService,
    StudyCertificateRenderer,
    ReportTemplatesService,
  ],
})
class TestReportsModule {}

export interface TestContext {
  app: INestApplication;
  replSet: MongoMemoryReplSet;
  seed: SeedService;
  close: () => Promise<void>;
}

/**
 * Boots the API against an in-memory MongoDB **replica set**.
 *
 * A replica set rather than a standalone server because the code under test uses
 * multi-document transactions, which standalone mongod rejects. This is the same
 * reason docker-compose runs mongo with `--replSet`.
 *
 * Redis-backed pieces are swapped for in-memory equivalents so the suite has no
 * external dependencies and can run in CI unchanged.
 */
export async function createTestApp(): Promise<TestContext> {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const uri = replSet.getUri();

  // The config validator requires these; set them before the module is built.
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = uri;
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-that-is-long-enough-for-validation';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-long-enough-for-validation';
  process.env.JWT_ACCESS_TTL = '15m';
  process.env.JWT_REFRESH_TTL = '7d';
  process.env.CORS_ORIGINS = 'http://localhost:3000';

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, cache: false }),
      MongooseModule.forRoot(uri),
      // Global, so every service can inject TransactionHelper — the same way
      // DatabaseModule provides it in the real application.
      TransactionModule,
      // In-memory cache instead of Redis.
      CacheModule.register({ isGlobal: true }),
      I18nModule,
      RecordScopeModule,
      StorageModule,
      AuditLogsModule,
      NotificationsModule,
      SettingsModule,
      HealthModule,
      AuthModule,
      RolesModule,
      UsersModule,
      LocationsModule,
      SchoolYearsModule,
      SemestersModule,
      GradeLevelsModule,
      SubjectsModule,
      ClassroomsModule,
      TeachersModule,
      GuardiansModule,
      StudentsModule,
      TeachingAssignmentsModule,
      EnrollmentsModule,
      ScoreComponentsModule,
      ScoresModule,
      ConductScoresModule,
      ConductDeductionsModule,
      AttendancesModule,

      // The real modules are imported and then overridden below, so that a
      // transitive importer (CertificatesModule → ReportsModule) picks up the
      // queue-free variant too.
      TermResultsModule,
      ReportsModule,

      LessonPlansModule,
      ExamsModule,
      CertificatesModule,
      AnnouncementsModule,
      CalendarModule,
      DocumentsModule,
      FeedbackModule,

      SeedModule,
    ],
    providers: [
      { provide: APP_FILTER, useClass: AllExceptionsFilter },
      // ThrottlerGuard is omitted: rate limits would make the suite flaky and
      // are verified separately.
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: PermissionsGuard },
    ],
  })
    // Swap out the two modules that register BullMQ queues and workers. A
    // worker constructed without Redis throws "Worker requires a connection"
    // during `app.init()`, so this has to happen at the module level rather
    // than by overriding a provider.
    .overrideModule(TermResultsModule)
    .useModule(TestTermResultsModule)
    .overrideModule(ReportsModule)
    .useModule(TestReportsModule)
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api', { exclude: ['health', 'health/ready'] });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();

  const seed = app.get(SeedService);
  await seed.run();

  return {
    app,
    replSet,
    seed,
    close: async () => {
      await app.close();
      await replSet.stop();
    },
  };
}

/** Logs in and returns the access token. */
export async function login(
  app: INestApplication,
  username: string,
  password: string,
): Promise<{ accessToken: string; refreshToken: string; userId: string }> {
  const request = (await import('supertest')).default;
  const response = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ username, password })
    .expect(200);

  return {
    accessToken: response.body.tokens.accessToken,
    refreshToken: response.body.tokens.refreshToken,
    userId: response.body.user.id,
  };
}

/** Bearer header helper, since every authenticated request needs one. */
export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export const ADMIN_USERNAME = 'admin';
export const ADMIN_PASSWORD = 'ChangeMe123';

/** What `markEveryGradeSubject` needs to find the sheet it is filling in. */
export interface MarkTarget {
  gradeLevelId: string;
  semesterId: string;
  classroomId: string;
  studentIds: string[];
}

/**
 * Fills in every subject of a grade that is not marked yet, and says how many
 * subjects that grade sits.
 *
 * The term average divides by the number of subjects the **grade** is marked in,
 * not by the ones that happen to have scores, and a student short of a subject
 * holds the whole result provisional and unpublishable. So a test that wants a
 * finished class has to mark the whole curriculum, not one subject — which is
 * what this does, and why it lives here rather than in one spec.
 *
 * Idempotent in both directions: a subject whose weights already total 100 gets
 * no new component, and a cell that already has a score is left alone. That is
 * what lets a spec mark one subject by hand, assert its exact figures, and then
 * call this to finish the rest without disturbing them.
 */
export async function markEveryGradeSubject(
  app: INestApplication,
  token: string,
  target: MarkTarget,
  /** Percentage every subject this fills in comes out at. */
  mark = 80,
): Promise<number> {
  const http = () => request(app.getHttpServer());
  const wanted = new Set(target.studentIds);

  const subjects = await http()
    .get(`/api/subjects?gradeLevelId=${target.gradeLevelId}&role=marked&limit=100`)
    .set(auth(token))
    .expect(200);

  const rows = subjects.body.data as { id: string }[];

  for (const subject of rows) {
    const query =
      `subjectId=${subject.id}&semesterId=${target.semesterId}` +
      `&classroomId=${target.classroomId}`;

    // A subject whose weights do not total 100 cannot be computed at all, and
    // specs leave part-weighted components behind, so only the shortfall is added.
    const summary = await http()
      .get(`/api/score-components/weight-summary?${query}`)
      .set(auth(token))
      .expect(200);

    const shortfall = 100 - (summary.body.totalWeight as number);
    if (shortfall > 0) {
      await http()
        .post('/api/score-components')
        .set(auth(token))
        .send({
          subjectId: subject.id,
          semesterId: target.semesterId,
          classroomId: target.classroomId,
          nameLo: 'ສອບເສັງທ້າຍພາກ',
          type: 'final',
          weight: shortfall,
          maxScore: 100,
        })
        .expect(201);
    }

    const components = await http()
      .get(`/api/score-components?${query}&limit=100`)
      .set(auth(token))
      .expect(200);

    for (const component of components.body.data as { id: string; maxScore: number }[]) {
      const grid = await http()
        .get(`/api/scores/entry-grid?componentId=${component.id}&classroomId=${target.classroomId}`)
        .set(auth(token))
        .expect(200);

      const blank = (grid.body.entries as { studentId: string; score: number | null }[]).filter(
        (entry) => entry.score === null && wanted.has(entry.studentId),
      );
      if (blank.length === 0) continue;

      await http()
        .post('/api/scores/batch')
        .set(auth(token))
        .send({
          componentId: component.id,
          classroomId: target.classroomId,
          // The same fraction of every component, so the subject comes out at
          // exactly `mark` whatever it is built from.
          entries: blank.map((entry) => ({
            studentId: entry.studentId,
            score: (component.maxScore * mark) / 100,
          })),
        })
        .expect(201);
    }
  }

  return rows.length;
}
