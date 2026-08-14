import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Certificate, CertificateSchema, Student, StudentSchema } from 'src/database/schemas';
import { ReportsModule } from '../reports/reports.module';
import { SchoolYearsModule } from '../school-years/school-years.module';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Certificate.name, schema: CertificateSchema },
      { name: Student.name, schema: StudentSchema },
    ]),
    // Reuses the PDF renderer, the report-data assembler and the template store.
    ReportsModule,
    SchoolYearsModule,
  ],
  controllers: [CertificatesController],
  providers: [CertificatesService],
  exports: [CertificatesService],
})
export class CertificatesModule {}
