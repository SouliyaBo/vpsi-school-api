import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  // Typed as the Express application so `set('trust proxy')` is available.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService<AppConfig, true>);
  const nodeEnv = config.get('NODE_ENV', { infer: true });
  const apiPrefix = config.get('API_PREFIX', { infer: true });
  const port = config.get('PORT', { infer: true });

  app.setGlobalPrefix(apiPrefix, { exclude: ['health', 'health/ready'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.use(helmet());

  // Explicit whitelist — never `origin: true`, which reflects any origin back
  // and defeats the point of CORS.
  const corsOrigins = config
    .get('CORS_ORIGINS', { infer: true })
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept-Language', 'X-Request-Id'],
  });

  // Behind a reverse proxy, so `request.ip` reflects X-Forwarded-For rather than
  // the proxy's own address — audit rows record the real client.
  app.set('trust proxy', 1);

  app.useGlobalPipes(
    new ValidationPipe({
      // Drop unknown properties instead of persisting them, and reject requests
      // that send them at all — mass-assignment protection.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      // Hide constraint internals in production responses.
      disableErrorMessages: nodeEnv === 'production',
    }),
  );

  app.enableShutdownHooks();

  // Swagger is served in non-production only: the schema is a map of the entire
  // attack surface, and there is no reason to publish it.
  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('VPSI School Management API')
      .setDescription(
        'ລະບົບບໍລິຫານຈັດການໂຮງຮຽນ — School Management System API.\n\n' +
          'All responses honour `Accept-Language` (`lo`, `en`) or `?lang=`. ' +
          'Every endpoint requires a bearer token unless marked otherwise, and is ' +
          'additionally gated by the role permission matrix.',
      )
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .addTag('auth', 'Authentication, tokens, and password management')
      .addTag('users', 'User accounts')
      .addTag('roles', 'Roles and the permission matrix')
      .addTag('locations', 'Province / district / village hierarchy')
      .addTag('school-years', 'School years')
      .addTag('semesters', 'Semesters')
      .addTag('grade-levels', 'Grade levels')
      .addTag('subjects', 'Subjects')
      .addTag('classrooms', 'Classrooms')
      .addTag('teachers', 'Teachers')
      .addTag('guardians', 'Guardians')
      .addTag('students', 'Students')
      .addTag('teaching-assignments', 'Teaching assignments and timetables')
      .addTag('enrollments', 'Enrollment and class placement')
      .addTag('score-components', 'Gradeable components and weights')
      .addTag('scores', 'Score entry, locking, and amendment')
      .addTag('conduct-scores', 'Conduct assessment')
      .addTag('attendances', 'Attendance recording and statistics')
      .addTag('term-results', 'Term result computation, ranking, and publication')
      .addTag('reports', 'Report templates and PDF generation')
      .addTag('lesson-plans', 'Lesson plans and the review workflow')
      .addTag('exams', 'M4/M7 exam registration, eligibility, and results')
      .addTag('certificates', 'Certificate issuance, revocation, and public verification')
      .addTag('announcements', 'Announcements and audience targeting')
      .addTag('notifications', 'In-app notification inbox')
      .addTag('calendar', 'Academic calendar')
      .addTag('documents', 'Document centre')
      .addTag('feedback', 'Feedback, including anonymous submissions')
      .addTag('settings', 'System settings')
      .addTag('vaccinations', 'Vaccination campaigns and per-student dose records')
      .addTag('audit-logs', 'Audit trail')
      .addTag('health', 'Liveness and readiness probes')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha' },
    });
  }

  // The worker container shares this image but must not bind the HTTP port;
  // BullMQ processors are already running from the module graph above.
  if (process.env.WORKER_MODE === 'true') {
    await app.init();
    return;
  }

  await app.listen(port);
}

void bootstrap();
