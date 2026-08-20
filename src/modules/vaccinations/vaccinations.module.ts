import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Enrollment,
  EnrollmentSchema,
  Student,
  StudentSchema,
  Vaccination,
  VaccinationCampaign,
  VaccinationCampaignSchema,
  VaccinationSchema,
} from 'src/database/schemas';
import { VaccinationsController } from './vaccinations.controller';
import { VaccinationsService } from './vaccinations.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VaccinationCampaign.name, schema: VaccinationCampaignSchema },
      { name: Vaccination.name, schema: VaccinationSchema },
      // Read-only here: the roll is built from enrolment and student records, and
      // registering them again is how this module reads them without depending on
      // StudentsModule, whose service it has no use for.
      { name: Student.name, schema: StudentSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
    ]),
  ],
  controllers: [VaccinationsController],
  providers: [VaccinationsService],
  exports: [VaccinationsService, MongooseModule],
})
export class VaccinationsModule {}
