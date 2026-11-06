import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ConductDeduction,
  ConductDeductionSchema,
  MonthlyMark,
  MonthlyMarkSchema,
  SubjectTermMark,
  SubjectTermMarkSchema,
} from 'src/database/schemas';
import { AttendancesModule } from '../attendances/attendances.module';
import { ClassroomsModule } from '../classrooms/classrooms.module';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { SemestersModule } from '../semesters/semesters.module';
import { SubjectsModule } from '../subjects/subjects.module';
import { TeachingAssignmentsModule } from '../teaching-assignments/teaching-assignments.module';
import { GradingScaleModule } from '../term-results/grading-scale.service';
import { TermResultStalenessModule } from '../term-results/term-result-staleness.service';
import { ClassYearService } from './class-year.service';
import { MonthlyMarksController } from './monthly-marks.controller';
import { MonthlyMarksService } from './monthly-marks.service';
import { MonthlyStandingService } from './monthly-standing.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MonthlyMark.name, schema: MonthlyMarkSchema },
      { name: SubjectTermMark.name, schema: SubjectTermMarkSchema },
      // ຄະແນນຖືກຕັດ month by month, for ໝົດປີ ທັງຫ້ອງ. The model alone: the
      // ledger's module reaches back into this graph through conduct scores.
      { name: ConductDeduction.name, schema: ConductDeductionSchema },
    ]),
    // ວັນຂາດ, counted by the roll's own rule, for the same sheet.
    AttendancesModule,
    // For the Enrollment model: the sheet is drawn against the class list.
    EnrollmentsModule,
    // For the Subject model, which declares the strands a sheet is split into.
    SubjectsModule,
    // For the Semester model and the active term.
    SemestersModule,
    // The sheet heads each page with ຫ້ອງ and its homeroom teacher.
    ClassroomsModule,
    // Only the teacher the timetable names may mark a class.
    TeachingAssignmentsModule,
    // A saved mark leaves the stored term result out of date, and it must say so.
    TermResultStalenessModule,
    // The school's letter bands, for the ເກຣດ column of the monthly summary.
    GradingScaleModule,
  ],
  controllers: [MonthlyMarksController],
  providers: [MonthlyMarksService, MonthlyStandingService, ClassYearService],
  exports: [MonthlyMarksService, MongooseModule],
})
export class MonthlyMarksModule {}
