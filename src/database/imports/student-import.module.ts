import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Classroom,
  ClassroomSchema,
  ConductScore,
  ConductScoreSchema,
  Enrollment,
  EnrollmentSchema,
  Guardian,
  GuardianSchema,
  Location,
  LocationSchema,
  SchoolYear,
  SchoolYearSchema,
  Semester,
  SemesterSchema,
  Student,
  StudentSchema,
  User,
  UserSchema,
} from 'src/database/schemas';
import { StudentImportService } from './student-import.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Student.name, schema: StudentSchema },
      { name: Guardian.name, schema: GuardianSchema },
      { name: Location.name, schema: LocationSchema },
      // Placement: the class a file's students belong to, and what a conduct
      // mark needs to be recorded against.
      { name: Classroom.name, schema: ClassroomSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: SchoolYear.name, schema: SchoolYearSchema },
      { name: Semester.name, schema: SemesterSchema },
      { name: ConductScore.name, schema: ConductScoreSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [StudentImportService],
  exports: [StudentImportService],
})
export class StudentImportModule {}
