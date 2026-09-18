import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Certificate,
  CertificateSchema,
  Classroom,
  ClassroomSchema,
  Enrollment,
  EnrollmentSchema,
  GradeLevel,
  GradeLevelSchema,
  Guardian,
  GuardianSchema,
  Location,
  LocationSchema,
  SchoolYear,
  SchoolYearSchema,
  Student,
  StudentSchema,
} from 'src/database/schemas';
import { ReportsModule } from '../reports/reports.module';
import { SchoolYearsModule } from '../school-years/school-years.module';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';
import { StudyCertificateDataService } from './study-certificate-data.service';
import { StudySuspensionDataService } from './study-suspension-data.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Certificate.name, schema: CertificateSchema },
      { name: Student.name, schema: StudentSchema },
      // Read-only: what a study-verification letter or a suspension memo states
      // about a pupil comes from the register — where they live, where they
      // were born, who their guardian is, and which class and years they were
      // enrolled for.
      { name: Location.name, schema: LocationSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: Classroom.name, schema: ClassroomSchema },
      { name: GradeLevel.name, schema: GradeLevelSchema },
      { name: Guardian.name, schema: GuardianSchema },
      { name: SchoolYear.name, schema: SchoolYearSchema },
    ]),
    // Reuses the PDF renderer, the report-data assembler and the template store.
    ReportsModule,
    SchoolYearsModule,
  ],
  controllers: [CertificatesController],
  providers: [CertificatesService, StudyCertificateDataService, StudySuspensionDataService],
  exports: [CertificatesService],
})
export class CertificatesModule {}
