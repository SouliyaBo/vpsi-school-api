import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { validateEnv } from 'src/config/configuration';
import { TeacherImportModule } from './teacher-import.module';
import { TeacherImportService, type TeacherImportReport } from './teacher-import.service';
import type { SourceTeacher } from './teacher-import.mapper';

/**
 * Loads the school's staff register from a JSON file.
 *
 *   npm run import:teachers -- ./data/teachers.json --dry-run
 *   npm run import:teachers -- ./data/teachers.json --year=2026-2027
 *
 * Codes are minted rather than read from the file — `T-2627-001` upward, in the
 * order the rows appear — because the register numbers its rows `1…17` and has
 * no staff number of its own. `--year` names the academic year the codes belong
 * to; without it the active year on file is used.
 *
 * Run with `--dry-run` first. The report names every value that could not be
 * read with certainty, and those are the fields the teachers will be asked to
 * fill in themselves.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    MongooseModule.forRoot(process.env.MONGODB_URI!),
    TeacherImportModule,
  ],
})
class TeacherImportCliModule {}

interface Args {
  file: string;
  dryRun: boolean;
  schoolYear?: string;
}

function parseArgs(argv: string[]): Args | null {
  const args = argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const file = args.find((arg) => !arg.startsWith('--'));

  // Accepts both `--year=2026-2027` and `--year 2026-2027`.
  const inline = args.find((arg) => arg.startsWith('--year='));
  const separate = args[args.indexOf('--year') + 1];
  const schoolYear = inline
    ? inline.slice('--year='.length)
    : args.includes('--year') && separate && !separate.startsWith('--')
      ? separate
      : undefined;

  return file ? { file: resolve(file), dryRun, schoolYear } : null;
}

function print(logger: Logger, report: TeacherImportReport, dryRun: boolean): void {
  logger.log(`Teachers: ${report.teachersCreated} created, ${report.teachersUpdated} updated`);
  logger.log(`Locations created: ${report.locationsCreated}`);

  if (report.codesIssued.length > 0) {
    logger.log(`Codes ${dryRun ? 'that would be' : ''} issued:`);
    for (const issued of report.codesIssued) logger.log(`  ${issued.code}  ${issued.name}`);
  }

  for (const warning of report.warnings) logger.warn(warning);

  if (report.skipped.length > 0) {
    logger.warn(`${report.skipped.length} rows skipped:`);
    for (const skip of report.skipped) logger.warn(`  row ${skip.row}: ${skip.reason}`);
  }

  logger.log(
    'Housing, marital status and children are read by what each cell says, not which ' +
      'column it is in — the source sheet lost two headers and its values slid across. ' +
      'Anything ambiguous was left empty for the teacher to fill in.',
  );

  if (dryRun) logger.log('Dry run — nothing was written.');
}

async function main(): Promise<void> {
  const logger = new Logger('TeacherImport');
  const args = parseArgs(process.argv);

  if (!args) {
    logger.error('Usage: npm run import:teachers -- <file.json> [--year="2026-2027"] [--dry-run]');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(TeacherImportCliModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const raw = await readFile(args.file, 'utf8');
    const rows = JSON.parse(raw) as SourceTeacher[];
    if (!Array.isArray(rows)) throw new Error('the file must contain a JSON array of teachers');

    logger.log(`Read ${rows.length} rows from ${args.file}`);

    const report = await app
      .get(TeacherImportService)
      .run(rows, { dryRun: args.dryRun, schoolYear: args.schoolYear });
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
