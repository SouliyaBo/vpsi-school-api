import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { validateEnv } from 'src/config/configuration';
import { StudentImportModule } from './student-import.module';
import { StudentImportService, type ImportReport } from './student-import.service';
import type { SourceStudent } from './student-import.mapper';

/**
 * Loads the school's existing student register from a JSON file.
 *
 *   npm run import:students -- ./students.json --dry-run
 *   npm run import:students -- ./students.json
 *   npm run import:students -- ./students.json --classroom="ມ.2/ກ"
 *
 * The register is kept one class per file and names the class on the folder
 * rather than in the rows, so `--classroom` supplies it; without it the students
 * import unplaced.
 *
 * Like the seed CLI, this boots only the database — the full graph would start
 * Redis and the queue workers for a script that writes a few hundred documents.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    MongooseModule.forRoot(process.env.MONGODB_URI!),
    StudentImportModule,
  ],
})
class StudentImportCliModule {}

interface Args {
  file: string;
  dryRun: boolean;
  classroom?: string;
}

function parseArgs(argv: string[]): Args | null {
  const args = argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const file = args.find((arg) => !arg.startsWith('--'));

  // Accepts both `--classroom=ມ.2/ກ` and `--classroom ມ.2/ກ`; a class name with
  // no spaces in it survives either way, and quoting is easy to forget.
  const inline = args.find((arg) => arg.startsWith('--classroom='));
  const separate = args[args.indexOf('--classroom') + 1];
  const classroom = inline
    ? inline.slice('--classroom='.length)
    : args.includes('--classroom') && separate && !separate.startsWith('--')
      ? separate
      : undefined;

  return file ? { file: resolve(file), dryRun, classroom } : null;
}

function print(logger: Logger, report: ImportReport, dryRun: boolean): void {
  const verb = dryRun ? 'would be' : 'were';
  logger.log(`Students: ${report.studentsCreated} created, ${report.studentsUpdated} updated`);
  logger.log(`Guardians: ${report.guardiansCreated} created, ${report.guardiansReused} reused`);
  logger.log(`Locations created: ${report.locationsCreated}`);
  logger.log(
    `Enrollments: ${report.enrollmentsCreated} created, ${report.enrollmentsReused} already in place`,
  );
  logger.log(`Conduct marks written: ${report.conductScoresWritten}`);
  logger.log('The English-programme class on each row is not imported, by design.');

  for (const warning of report.warnings) logger.warn(warning);

  if (report.skipped.length > 0) {
    logger.warn(`${report.skipped.length} rows ${verb} skipped:`);
    for (const skip of report.skipped) logger.warn(`  ${skip.studentId}: ${skip.reason}`);
  }

  if (dryRun) logger.log('Dry run — nothing was written.');
}

async function main(): Promise<void> {
  const logger = new Logger('StudentImport');
  const args = parseArgs(process.argv);

  if (!args) {
    logger.error('Usage: npm run import:students -- <file.json> [--classroom="ມ.2/ກ"] [--dry-run]');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(StudentImportCliModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const raw = await readFile(args.file, 'utf8');
    const rows = JSON.parse(raw) as SourceStudent[];
    if (!Array.isArray(rows)) throw new Error('the file must contain a JSON array of students');

    logger.log(`Read ${rows.length} rows from ${args.file}`);
    if (args.classroom) logger.log(`Placing them in classroom "${args.classroom}"`);
    else logger.warn('No --classroom given — students will be imported without a class.');

    const report = await app
      .get(StudentImportService)
      .run(rows, { dryRun: args.dryRun, classroom: args.classroom });
    print(logger, report, args.dryRun);
  } catch (error) {
    logger.error('Import failed', error instanceof Error ? error.stack : String(error));
    await app.close();
    process.exit(1);
  }

  await app.close();
  process.exit(0);
}

void main();
