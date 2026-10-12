import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Enrollment, EnrollmentSchema } from 'src/database/schemas';
import { ClassroomsModule } from '../classrooms/classrooms.module';
import { StudentsModule } from '../students/students.module';
import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Enrollment.name, schema: EnrollmentSchema }]),
    ClassroomsModule,
    // Provides the Student and SchoolYear models.
    StudentsModule,
  ],
  controllers: [EnrollmentsController],
  providers: [EnrollmentsService],
  exports: [EnrollmentsService, MongooseModule],
})
export class EnrollmentsModule {}
