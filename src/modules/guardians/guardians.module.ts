import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Guardian, GuardianSchema, Student, StudentSchema } from 'src/database/schemas';
import { GuardiansController } from './guardians.controller';
import { GuardiansService } from './guardians.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Guardian.name, schema: GuardianSchema },
      // The Student model is needed to sync the denormalized guardian fields.
      { name: Student.name, schema: StudentSchema },
    ]),
  ],
  controllers: [GuardiansController],
  providers: [GuardiansService],
  exports: [GuardiansService, MongooseModule],
})
export class GuardiansModule {}
