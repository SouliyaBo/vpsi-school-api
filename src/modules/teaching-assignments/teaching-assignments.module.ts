import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TeachingAssignment, TeachingAssignmentSchema } from 'src/database/schemas';
import { ClassroomsModule } from '../classrooms/classrooms.module';
import { SemestersModule } from '../semesters/semesters.module';
import { SubjectsModule } from '../subjects/subjects.module';
import { TeachersModule } from '../teachers/teachers.module';
import { TeachingAssignmentsController } from './teaching-assignments.controller';
import { TeachingAssignmentsService } from './teaching-assignments.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TeachingAssignment.name, schema: TeachingAssignmentSchema },
    ]),
    TeachersModule,
    SubjectsModule,
    ClassroomsModule,
    SemestersModule,
  ],
  controllers: [TeachingAssignmentsController],
  providers: [TeachingAssignmentsService],
  exports: [TeachingAssignmentsService, MongooseModule],
})
export class TeachingAssignmentsModule {}
