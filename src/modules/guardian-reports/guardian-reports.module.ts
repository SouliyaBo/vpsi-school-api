import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  BehaviorLog,
  BehaviorLogSchema,
  Classroom,
  ClassroomSchema,
  Enrollment,
  EnrollmentSchema,
  Guardian,
  GuardianReport,
  GuardianReportSchema,
  GuardianSchema,
  Student,
  StudentSchema,
  Teacher,
  TeacherSchema,
} from 'src/database/schemas';
import { AttendancesModule } from '../attendances/attendances.module';
import { ConductDeductionsModule } from '../conduct-deductions/conduct-deductions.module';
import { MonthlyMarksModule } from '../monthly-marks/monthly-marks.module';
import { SemestersModule } from '../semesters/semesters.module';
import { GuardianReportsController } from './guardian-reports.controller';
import { GuardianReportsService } from './guardian-reports.service';

/**
 * ລາຍງານຫາຜູ້ປົກຄອງ.
 *
 * Imports the fact modules rather than reading their collections, as
 * `HomeroomReviewsModule` does and for its reason: the marks, the roll call and
 * the conduct ledger a family is sent must be the numbers the school's own
 * screens show. The register is the exception, read directly — the report wants
 * one child's lines, which no service exposes.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GuardianReport.name, schema: GuardianReportSchema },
      { name: Student.name, schema: StudentSchema },
      { name: Guardian.name, schema: GuardianSchema },
      { name: Classroom.name, schema: ClassroomSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: BehaviorLog.name, schema: BehaviorLogSchema },
      { name: Teacher.name, schema: TeacherSchema },
    ]),
    SemestersModule,
    MonthlyMarksModule,
    AttendancesModule,
    ConductDeductionsModule,
  ],
  controllers: [GuardianReportsController],
  providers: [GuardianReportsService],
})
export class GuardianReportsModule {}
