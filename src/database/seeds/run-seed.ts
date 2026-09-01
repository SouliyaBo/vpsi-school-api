import { Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { Module } from '@nestjs/common';
import { validateEnv } from 'src/config/configuration';
import { SeedModule } from './seed.module';
import { SeedService } from './seed.service';

/**
 * Minimal module for the seed CLI.
 *
 * Deliberately not AppModule: seeding needs a database connection and nothing
 * else, and booting the full graph would start Redis, BullMQ workers and the
 * HTTP guards for a one-shot script.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    MongooseModule.forRoot(process.env.MONGODB_URI!),
    SeedModule,
  ],
})
class SeedCliModule {}

/**
 * What to run.
 *
 * `all` is a first-run operation: besides the roles it upserts settings, the
 * subject catalogue and a set of demo teachers, classrooms and locations, so on a
 * database already holding a school's data it resets the school name and the
 * timetable window and adds fixtures. **It has already cost this project a
 * subject rename and four resurrected subject groups — do not run it against a
 * database in use.**
 *
 * `roles` re-applies only the permission matrix, which is what a newly added
 * resource needs and is safe at any time. `settings` re-applies only the settings
 * catalogue — use it when a new setting key has to reach a live database, which
 * is otherwise the reason people reach for `all`.
 */
const STEPS = ['all', 'roles', 'settings'] as const;
type Step = (typeof STEPS)[number];

function parseStep(argument: string | undefined): Step {
  if (argument === undefined) return 'all';
  if ((STEPS as readonly string[]).includes(argument)) return argument as Step;
  throw new Error(`Unknown step "${argument}". Expected one of: ${STEPS.join(', ')}`);
}

async function main(): Promise<void> {
  const logger = new Logger('Seed');

  let step: Step;
  try {
    step = parseStep(process.argv[2]);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(SeedCliModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const seeder = app.get(SeedService);
    if (step === 'roles') await seeder.syncRoles();
    else if (step === 'settings') await seeder.syncSettings();
    else await seeder.run();
  } catch (error) {
    logger.error('Seeding failed', error instanceof Error ? error.stack : String(error));
    await app.close();
    process.exit(1);
  }

  await app.close();
  process.exit(0);
}

void main();
