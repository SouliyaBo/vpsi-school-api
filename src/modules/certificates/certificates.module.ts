import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Certificate,
  CertificateSchema,
  Enrollment,
  EnrollmentSchema,
  GradeLevel,
  GradeLevelSchema,
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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Certificate.name, schema: CertificateSchema },
      { name: Student.name, schema: StudentSchema },
      // Read-only: what a study-verification letter states about a pupil comes
      // from the register — where they live, where they were born, and which
      // years they were enrolled for.
      { name: Location.name, schema: LocationSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: GradeLevel.name, schema: GradeLevelSchema },
      { name: SchoolYear.name, schema: SchoolYearSchema },
    ]),
    // Reuses the PDF renderer, the report-data assembler and the template store.
    ReportsModule,
    SchoolYearsModule,
  ],
  controllers: [CertificatesController],
  providers: [CertificatesService, StudyCertificateDataService],
  exports: [CertificatesService],
})
export class CertificatesModule {}
