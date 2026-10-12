import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { RecordScopeModule } from '../common/services/record-scope.service';
import { TransactionHelper } from '../database/transaction.helper';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { BehaviorLogsModule } from './behavior-logs/behavior-logs.module';
import { BehaviorLogsService } from './behavior-logs/behavior-logs.service';
import { ConductDeductionsModule } from './conduct-deductions/conduct-deductions.module';
import { ConductDeductionsService } from './conduct-deductions/conduct-deductions.service';
import { HomeroomReviewsModule } from './homeroom-reviews/homeroom-reviews.module';
import { HomeroomReviewsService } from './homeroom-reviews/homeroom-reviews.service';
import { LessonPlansModule } from './lesson-plans/lesson-plans.module';
import { LessonPlansService } from './lesson-plans/lesson-plans.service';
import { LessonSubstitutionsModule } from './lesson-substitutions/lesson-substitutions.module';
import { LessonSubstitutionsService } from './lesson-substitutions/lesson-substitutions.service';
import { MonthlyMarksModule } from './monthly-marks/monthly-marks.module';
import { MonthlyMarksService } from './monthly-marks/monthly-marks.service';
import { NotificationsModule } from './notifications/notifications.module';
import { SettingsModule } from './settings/settings.module';
import { TelegramModule } from './telegram/telegram.module';
import { StorageModule } from './storage/storage.module';
import { TeacherHandoverModule } from './teacher-handover/teacher-handover.module';
import { TeacherHandoverService } from './teacher-handover/teacher-handover.service';
import { SubjectGroupsModule } from './subject-groups/subject-groups.module';
import { SubjectGroupsService } from './subject-groups/subject-groups.service';
import { SubjectsModule } from './subjects/subjects.module';
import { SubjectsService } from './subjects/subjects.service';
import { TeachersModule } from './teachers/teachers.module';
import { TeachersService } from './teachers/teachers.service';
import { TeachingObservationsModule } from './teaching-observations/teaching-observations.module';
import { TeachingObservationsService } from './teaching-observations/teaching-observations.service';
import { VaccinationsModule } from './vaccinations/vaccinations.module';
import { VaccinationsService } from './vaccinations/vaccinations.service';

/**
 * Does the DI graph of the subject-group modules actually resolve?
 *
 * A missing module import is invisible to the compiler and to every unit test —
 * it surfaces only at boot, as `Nest can't resolve dependencies of X`. These
 * modules are the ones most exposed to it: `SubjectsService` and
 * `TeachersService` reach for `SubjectGroupsService`, and `LessonPlansService`
 * takes six models the compliance matrix reads. Each has to be declared
 * somewhere, and this is what says so without a database.
 */

/** Every model token these modules inject, directly or through a dependency. */
const MODELS = [
  'AuditLog',
  // The homeroom review triages on the roll call, which puts it in this graph.
  'Attendance',
  'BehaviorLog',
  'CalendarEvent',
  'Classroom',
  'ConductDeduction',
  'ConductRule',
  'ConductScore',
  'Enrollment',
  // ຮ່າງບົດສະຫຼຸບຄູປະຈຳຫ້ອງ — what the homeroom teacher writes and sends each month.
  'HomeroomMonthlyReport',
  // StudentsService re-syncs the copy of `studentCode` these hold when the
  // office reissues one, which puts them in the graph of anything reading the
  // roster.
  'ExamRegistration',
  'GradeLevel',
  'HomeroomReview',
  'Guardian',
  'LessonPlan',
  // Both per-lesson logs resolve cover before they authorize a write.
  'LessonSubstitution',
  'LessonPlanMonth',
  'LessonPlanTask',
  'Location',
  'MonthlyMark',
  'Notification',
  'Role',
  'SchoolYear',
  'Semester',
  'Setting',
  'Student',
  'Subject',
  'SubjectGroup',
  'SubjectTermMark',
  'Teacher',
  'TeachingAssignment',
  'TeachingObservation',
  // Every mark-entry module flags stored term results as out of date, which puts
  // this model in their graph without their owning it.
  'TermResult',
  'User',
  'Vaccination',
  'VaccinationCampaign',
];

/**
 * Stands in for the roots that would open a connection.
 *
 * `CacheModule.registerAsync` reaches for Redis and `TransactionHelper` for the
 * Mongoose connection; the graph check only needs the tokens to exist.
 */
@Global()
@Module({
  providers: [
    {
      provide: CACHE_MANAGER,
      useValue: {
        get: async () => undefined,
        set: async () => undefined,
        del: async () => undefined,
      },
    },
    { provide: TransactionHelper, useValue: { run: async (fn: unknown) => fn } },
  ],
  exports: [CACHE_MANAGER, TransactionHelper],
})
class StubInfrastructureModule {}

/**
 * The `@Global()` modules `AppModule` registers at the root.
 *
 * A testing module gets no globals for free, so without these every service that
 * audits or notifies fails to resolve — which would read as a wiring bug in the
 * module under test rather than a gap in this harness.
 */
const GLOBALS = [
  ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
  StubInfrastructureModule,
  AuditLogsModule,
  // Registered ahead of notifications, which now deliver through it.
  TelegramModule,
  NotificationsModule,
  RecordScopeModule,
  SettingsModule,
  StorageModule,
];

async function build(imports: unknown[]) {
  let builder = Test.createTestingModule({ imports: [...GLOBALS, ...imports] as never });
  for (const name of MODELS) {
    builder = builder.overrideProvider(getModelToken(name)).useValue({});
  }
  return builder.compile();
}

describe('module wiring', () => {
  it('resolves the subject-groups module', async () => {
    const app = await build([SubjectGroupsModule]);
    expect(app.get(SubjectGroupsService)).toBeInstanceOf(SubjectGroupsService);
    await app.close();
  });

  it('resolves subjects, which validates a subject group on write', async () => {
    const app = await build([SubjectsModule]);
    expect(app.get(SubjectsService)).toBeInstanceOf(SubjectsService);
    await app.close();
  });

  it('resolves teachers, which validates a subject group on write', async () => {
    const app = await build([TeachersModule]);
    expect(app.get(TeachersService)).toBeInstanceOf(TeachersService);
    await app.close();
  });

  // The widest import list of the three teacher-shaped modules: a handover writes
  // the timetable and the rooms, both of whose modules import TeachersModule — so
  // this is the one that would surface a cycle rather than a missing provider.
  it('resolves the teacher handover, which writes the timetable and the rooms', async () => {
    const app = await build([TeacherHandoverModule]);
    expect(app.get(TeacherHandoverService)).toBeInstanceOf(TeacherHandoverService);
    await app.close();
  });

  it('resolves behavior logs, which reach for classrooms, semesters and the roster', async () => {
    const app = await build([BehaviorLogsModule]);
    expect(app.get(BehaviorLogsService)).toBeInstanceOf(BehaviorLogsService);
    await app.close();
  });

  // Both per-lesson logs now take `LessonAccessService`, which declares the
  // substitution and timetable models itself. A claim endpoint that resolved but
  // a register that did not would be the wiring bug this file exists to catch.
  it('resolves lesson substitutions, which read the timetable and the calendar', async () => {
    const app = await build([LessonSubstitutionsModule]);
    expect(app.get(LessonSubstitutionsService)).toBeInstanceOf(LessonSubstitutionsService);
    await app.close();
  });

  // The widest graph of the lot: the homeroom review triages on the roll call,
  // the register and the discipline ledger rather than aggregating any of them
  // again, so all three services plus the calendar have to resolve for it.
  it('resolves homeroom reviews, which read attendance, behaviour and conduct', async () => {
    const app = await build([HomeroomReviewsModule]);
    expect(app.get(HomeroomReviewsService)).toBeInstanceOf(HomeroomReviewsService);
    await app.close();
  });

  // Publishes the term's conduct score as a side effect of taking points, which
  // puts ConductScoresService in its graph without its owning that collection.
  it('resolves conduct deductions, which publish the conduct score they compute', async () => {
    const app = await build([ConductDeductionsModule]);
    expect(app.get(ConductDeductionsService)).toBeInstanceOf(ConductDeductionsService);
    await app.close();
  });

  it('resolves monthly marks, which cross the roster with the timetable', async () => {
    const app = await build([MonthlyMarksModule]);
    expect(app.get(MonthlyMarksService)).toBeInstanceOf(MonthlyMarksService);
    await app.close();
  });

  it('resolves lesson plans with every model the compliance matrix reads', async () => {
    const app = await build([LessonPlansModule]);
    expect(app.get(LessonPlansService)).toBeInstanceOf(LessonPlansService);
    await app.close();
  });

  // Registers Teacher, Subject and Semester itself rather than importing their
  // modules, for the same reason vaccinations does — and it is the same
  // arrangement that only fails at boot.
  it('resolves teaching observations, which register the models they read', async () => {
    const app = await build([TeachingObservationsModule]);
    expect(app.get(TeachingObservationsService)).toBeInstanceOf(TeachingObservationsService);
    await app.close();
  });

  // Builds a campaign roll from students and enrolments without importing
  // StudentsModule or EnrollmentsModule — it registers those two models itself,
  // which is the kind of arrangement that only fails at boot.
  it('resolves vaccinations, which read students and enrolments directly', async () => {
    const app = await build([VaccinationsModule]);
    expect(app.get(VaccinationsService)).toBeInstanceOf(VaccinationsService);
    await app.close();
  });
});
