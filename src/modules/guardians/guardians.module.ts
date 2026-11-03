import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Enrollment,
  EnrollmentSchema,
  Guardian,
  GuardianSchema,
  SchoolYear,
  SchoolYearSchema,
  Student,
  StudentSchema,
} from 'src/database/schemas';
import { GuardiansController } from './guardians.controller';
import { GuardiansService } from './guardians.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Guardian.name, schema: GuardianSchema },
      // The Student model is needed to sync the denormalized guardian fields.
      { name: Student.name, schema: StudentSchema },
      // The list shows which room each guardian's children sit in this year,
      // and filters by it — placement lives on the enrollment.
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: SchoolYear.name, schema: SchoolYearSchema },
    ]),
  ],
  controllers: [GuardiansController],
  providers: [GuardiansService],
  exports: [GuardiansService, MongooseModule],
})
export class GuardiansModule {}
