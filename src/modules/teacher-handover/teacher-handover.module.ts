import { Module } from '@nestjs/common';
import { ClassroomsModule } from '../classrooms/classrooms.module';
import { SemestersModule } from '../semesters/semesters.module';
import { SubjectGroupsModule } from '../subject-groups/subject-groups.module';
import { TeachersModule } from '../teachers/teachers.module';
import { TeachingAssignmentsModule } from '../teaching-assignments/teaching-assignments.module';
import { TeacherHandoverController } from './teacher-handover.controller';
import { TeacherHandoverService } from './teacher-handover.service';

/**
 * Its own module so a handover can import everything it writes.
 *
 * `ClassroomsModule` and `TeachingAssignmentsModule` both import
 * `TeachersModule`, so this work cannot live in the teachers module without
 * closing a cycle. Nothing imports this one, which is what makes that safe.
 */
@Module({
  imports: [
    TeachersModule,
    // For the TeachingAssignment model and the clash rules a moved lesson is
    // checked against.
    TeachingAssignmentsModule,
    // `setHomeroomTeacher` — the one writer that keeps a room's homeroom history
    // in step with its current holder.
    ClassroomsModule,
    // A closed term's timetable is a record, not a plan, and is left alone.
    SemestersModule,
    SubjectGroupsModule,
  ],
  controllers: [TeacherHandoverController],
  providers: [TeacherHandoverService],
})
export class TeacherHandoverModule {}
