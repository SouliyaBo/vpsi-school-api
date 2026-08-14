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
import { LessonPlansModule } from './lesson-plans/lesson-plans.module';
import { LessonPlansService } from './lesson-plans/lesson-plans.service';
import { NotificationsModule } from './notifications/notifications.module';
import { SettingsModule } from './settings/settings.module';
import { StorageModule } from './storage/storage.module';
import { SubjectGroupsModule } from './subject-groups/subject-groups.module';
import { SubjectGroupsService } from './subject-groups/subject-groups.service';
import { SubjectsModule } from './subjects/subjects.module';
import { SubjectsService } from './subjects/subjects.service';
import { TeachersModule } from './teachers/teachers.module';
import { TeachersService } from './teachers/teachers.service';

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
  'BehaviorLog',
  'CalendarEvent',
  'Classroom',
  'Enrollment',
  'GradeLevel',
  'Guardian',
  'LessonPlan',
  'LessonPlanMonth',
  'LessonPlanTask',
  'Location',
  'Notification',
  'Role',
  'SchoolYear',
  'Semester',
  'Setting',
  'Student',
  'Subject',
  'SubjectGroup',
  'Teacher',
  'TeachingAssignment',
  'User',
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

  it('resolves behavior logs, which reach for classrooms, semesters and the roster', async () => {
    const app = await build([BehaviorLogsModule]);
    expect(app.get(BehaviorLogsService)).toBeInstanceOf(BehaviorLogsService);
    await app.close();
  });

  it('resolves lesson plans with every model the compliance matrix reads', async () => {
    const app = await build([LessonPlansModule]);
    expect(app.get(LessonPlansService)).toBeInstanceOf(LessonPlansService);
    await app.close();
  });
});
