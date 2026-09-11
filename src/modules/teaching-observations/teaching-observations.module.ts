import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Semester,
  SemesterSchema,
  Subject,
  SubjectSchema,
  Teacher,
  TeacherSchema,
  TeachingObservation,
  TeachingObservationSchema,
} from 'src/database/schemas';

import { TeachingObservationsController } from './teaching-observations.controller';
import { TeachingObservationsService } from './teaching-observations.service';

/**
 * ຕິດຕາມການສອນຂອງຄູ.
 *
 * The models are registered here rather than pulled in as feature modules
 * because the reads are narrow — a teacher's name for the head of the sheet, a
 * subject's department, the active term — and importing TeachersModule and
 * SubjectsModule for three `findOne`s would drag their whole dependency graphs
 * into a module that observes lessons.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TeachingObservation.name, schema: TeachingObservationSchema },
      { name: Teacher.name, schema: TeacherSchema },
      { name: Subject.name, schema: SubjectSchema },
      { name: Semester.name, schema: SemesterSchema },
    ]),
  ],
  controllers: [TeachingObservationsController],
  providers: [TeachingObservationsService],
  exports: [TeachingObservationsService, MongooseModule],
})
export class TeachingObservationsModule {}
