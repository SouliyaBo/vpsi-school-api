import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
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
  TermResult,
  TermResultSchema,
} from 'src/database/schemas';
import { AttendancesModule } from '../attendances/attendances.module';
import { PdfRendererService } from './pdf/pdf-renderer.service';
import { ReportDataService } from './report-data.service';
import { ReportTemplatesService } from './report-templates.service';
import { ReportsController } from './reports.controller';
import { REPORTS_QUEUE, ReportsProcessor, ReportsQueueService } from './reports.queue';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ReportTemplate.name, schema: ReportTemplateSchema },
      { name: GeneratedReport.name, schema: GeneratedReportSchema },
      // Read-only models the report assembler needs. Declared here rather than
      // imported from their owning modules to keep this leaf module cycle-free.
      { name: TermResult.name, schema: TermResultSchema },
      { name: Student.name, schema: StudentSchema },
      { name: Classroom.name, schema: ClassroomSchema },
      { name: GradeLevel.name, schema: GradeLevelSchema },
      { name: SchoolYear.name, schema: SchoolYearSchema },
      { name: Semester.name, schema: SemesterSchema },
    ]),
    BullModule.registerQueue({ name: REPORTS_QUEUE }),
    AttendancesModule,
  ],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReportTemplatesService,
    ReportDataService,
    PdfRendererService,
    ReportsQueueService,
    ReportsProcessor,
  ],
  exports: [ReportsService, ReportDataService, PdfRendererService, ReportTemplatesService],
})
export class ReportsModule {}
