import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Enrollment,
  EnrollmentSchema,
  ExamRegistration,
  ExamRegistrationSchema,
  SchoolYear,
  SchoolYearSchema,
  Student,
  StudentSchema,
  TermResult,
  TermResultSchema,
} from 'src/database/schemas';
import { GuardiansModule } from '../guardians/guardians.module';
import { LocationsModule } from '../locations/locations.module';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Student.name, schema: StudentSchema },
      // Needed to translate classroom/grade-level filters into student ids, and
      // to resolve each student's current placement.
      { name: Enrollment.name, schema: EnrollmentSchema },
      // Placement filters default to the active school year.
      { name: SchoolYear.name, schema: SchoolYearSchema },
      // Both hold a denormalized `studentCode`, re-synced when the office
      // reissues one — see StudentsService.syncStudentCode.
      { name: ExamRegistration.name, schema: ExamRegistrationSchema },
      { name: TermResult.name, schema: TermResultSchema },
    ]),
    GuardiansModule,
    LocationsModule,
  ],
  controllers: [StudentsController],
  providers: [StudentsService],
  exports: [StudentsService, MongooseModule],
})
export class StudentsModule {}
