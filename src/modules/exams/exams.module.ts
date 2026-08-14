import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Enrollment,
  EnrollmentSchema,
  ExamRegistration,
  ExamRegistrationSchema,
  ExamResult,
  ExamResultSchema,
  GradeLevel,
  GradeLevelSchema,
  Student,
  StudentSchema,
  TermResult,
  TermResultSchema,
} from 'src/database/schemas';
import { AttendancesModule } from '../attendances/attendances.module';
import { SchoolYearsModule } from '../school-years/school-years.module';
import { SemestersModule } from '../semesters/semesters.module';
import { ExamsController } from './exams.controller';
import { ExamsService } from './exams.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExamRegistration.name, schema: ExamRegistrationSchema },
      { name: ExamResult.name, schema: ExamResultSchema },
      // Read-only models the eligibility check consults.
      { name: Student.name, schema: StudentSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: GradeLevel.name, schema: GradeLevelSchema },
      { name: TermResult.name, schema: TermResultSchema },
    ]),
    AttendancesModule,
    SchoolYearsModule,
    SemestersModule,
  ],
  controllers: [ExamsController],
  providers: [ExamsService],
  exports: [ExamsService],
})
export class ExamsModule {}
