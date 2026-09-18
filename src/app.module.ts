import { BullModule } from '@nestjs/bullmq';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { redisStore } from 'cache-manager-ioredis-yet';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { I18nModule } from './common/i18n/i18n.module';
import { RecordScopeModule } from './common/services/record-scope.service';
import { AppConfig, validateEnv } from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { AttendancesModule } from './modules/attendances/attendances.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { AuthModule } from './modules/auth/auth.module';
import { BehaviorLogsModule } from './modules/behavior-logs/behavior-logs.module';
import { MonthlyMarksModule } from './modules/monthly-marks/monthly-marks.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { CertificatesModule } from './modules/certificates/certificates.module';
import { ClassroomsModule } from './modules/classrooms/classrooms.module';
import { ConductDeductionsModule } from './modules/conduct-deductions/conduct-deductions.module';
import { ConductScoresModule } from './modules/conduct-scores/conduct-scores.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { EnrollmentsModule } from './modules/enrollments/enrollments.module';
import { ExamsModule } from './modules/exams/exams.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { GradeLevelsModule } from './modules/grade-levels/grade-levels.module';
import { GuardiansModule } from './modules/guardians/guardians.module';
import { HealthModule } from './modules/health/health.module';
import { LessonPlansModule } from './modules/lesson-plans/lesson-plans.module';
import { TeachingObservationsModule } from './modules/teaching-observations/teaching-observations.module';
import { ExamPapersModule } from './modules/exam-papers/exam-papers.module';
import { LocationsModule } from './modules/locations/locations.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReportsModule } from './modules/reports/reports.module';
import { RolesModule } from './modules/roles/roles.module';
import { SchoolYearsModule } from './modules/school-years/school-years.module';
import { ScoreComponentsModule } from './modules/score-components/score-components.module';
import { ScoresModule } from './modules/scores/scores.module';
import { SemestersModule } from './modules/semesters/semesters.module';
import { SettingsModule } from './modules/settings/settings.module';
import { StorageModule } from './modules/storage/storage.module';
import { StudentsModule } from './modules/students/students.module';
import { SubjectGroupsModule } from './modules/subject-groups/subject-groups.module';
import { SubjectsModule } from './modules/subjects/subjects.module';
import { TeachersModule } from './modules/teachers/teachers.module';
import { TeachingAssignmentsModule } from './modules/teaching-assignments/teaching-assignments.module';
import { TermResultsModule } from './modules/term-results/term-results.module';
import { VaccinationsModule } from './modules/vaccinations/vaccinations.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Validated at bootstrap, so a bad env var fails the process rather than
      // the first request that needs it.
      validate: validateEnv,
      cache: true,
    }),

    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          // Credentials and tokens must never reach the log stream.
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.newPassword',
            'req.body.currentPassword',
            'req.body.temporaryPassword',
            'req.body.refreshToken',
            'res.body.tokens',
          ],
          autoLogging: {
            ignore: (req) => req.url === '/health' || req.url === '/api/health',
          },
        },
      }),
    }),

    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: async (config: ConfigService<AppConfig, true>) => ({
        store: await redisStore({
          host: config.get('REDIS_HOST', { infer: true }),
          port: config.get('REDIS_PORT', { infer: true }),
          password: config.get('REDIS_PASSWORD', { infer: true }) || undefined,
          ttl: config.get('CACHE_TTL_SECONDS', { infer: true }) * 1000,
        }),
      }),
    }),

    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        connection: {
          host: config.get('REDIS_HOST', { infer: true }),
          port: config.get('REDIS_PORT', { infer: true }),
          password: config.get('REDIS_PASSWORD', { infer: true }) || undefined,
        },
      }),
    }),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        throttlers: [
          {
            ttl: config.get('THROTTLE_TTL_SECONDS', { infer: true }) * 1000,
            limit: config.get('THROTTLE_LIMIT', { infer: true }),
          },
        ],
      }),
    }),

    DatabaseModule,
    I18nModule,
    RecordScopeModule,
    StorageModule,
    AuditLogsModule,
    NotificationsModule,
    SettingsModule,
    HealthModule,

    // Phase 0 — authentication and authorization
    AuthModule,
    RolesModule,
    UsersModule,

    // Phase 1 — master data
    LocationsModule,
    SchoolYearsModule,
    SemestersModule,
    GradeLevelsModule,
    SubjectGroupsModule,
    SubjectsModule,
    ClassroomsModule,
    TeachersModule,
    GuardiansModule,
    StudentsModule,

    // Phase 2 — academic operations
    TeachingAssignmentsModule,
    EnrollmentsModule,
    ScoreComponentsModule,
    ScoresModule,
    ConductScoresModule,
    ConductDeductionsModule,
    AttendancesModule,
    BehaviorLogsModule,
    MonthlyMarksModule,
    TermResultsModule,
    VaccinationsModule,

    // Phase 3 — reporting and lesson plans
    ReportsModule,
    LessonPlansModule,
    TeachingObservationsModule,
    ExamPapersModule,

    // Phase 4 — exams and certificates
    ExamsModule,
    CertificatesModule,

    // Phase 5 — communication
    AnnouncementsModule,
    CalendarModule,
    DocumentsModule,
    FeedbackModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Order matters: throttle, then authenticate, then authorize. Rejecting an
    // unauthenticated flood before it touches the database is the point.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
