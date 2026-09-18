import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Classroom,
  ClassroomSchema,
  Enrollment,
  EnrollmentSchema,
  ExamPaper,
  ExamPaperSchema,
  ExamResponse,
  ExamResponseSchema,
  ExamScan,
  ExamScanSchema,
} from 'src/database/schemas';
import { MonthlyMarksModule } from '../monthly-marks/monthly-marks.module';
import { SemestersModule } from '../semesters/semesters.module';
import { ExamPapersController } from './exam-papers.controller';
import { ExamPapersService } from './exam-papers.service';
import { AnswerSheetRenderer } from './print/answer-sheet.renderer';
import { ExamPaperDocxWriter } from './print/exam-paper.docx.writer';
import { ExamPaperRenderer } from './print/exam-paper.renderer';

/**
 * ບົດສອບປາລະໄນ — multiple-choice papers shuffled into sets.
 *
 * Reads the class roll straight from the enrollment model for the seat plan
 * rather than importing EnrollmentsModule: one sorted `find` does not
 * justify its dependency graph. Storage, settings and audit are global.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExamPaper.name, schema: ExamPaperSchema },
      { name: ExamResponse.name, schema: ExamResponseSchema },
      { name: ExamScan.name, schema: ExamScanSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: Classroom.name, schema: ClassroomSchema },
    ]),
    // The marks go in through the monthly sheet's own save — see
    // ExamPapersService.pushToMonthlyMarks — so its module comes along.
    MonthlyMarksModule,
    SemestersModule,
  ],
  controllers: [ExamPapersController],
  providers: [ExamPapersService, ExamPaperRenderer, ExamPaperDocxWriter, AnswerSheetRenderer],
  exports: [ExamPapersService],
})
export class ExamPapersModule {}
