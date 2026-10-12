import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LessonAccessModule } from 'src/common/lesson-access/lesson-access.service';
import { Attendance, AttendanceSchema } from 'src/database/schemas';
import { CalendarModule } from '../calendar/calendar.module';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { SemestersModule } from '../semesters/semesters.module';
import { TeachingAssignmentsModule } from '../teaching-assignments/teaching-assignments.module';
import { AttendancesController } from './attendances.controller';
import { AttendancesService } from './attendances.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Attendance.name, schema: AttendanceSchema }]),
    // The school calendar, which decides which days a lesson was owed on.
    CalendarModule,
    EnrollmentsModule,
    SemestersModule,
    // For the TeachingAssignment model: every record is anchored to a lesson,
    // which is resolved and authorized before anything is written.
    TeachingAssignmentsModule,
    // Who may write a lesson up — the timetabled teacher, the office, or whoever
    // claimed cover for that day. Shared with the behaviour register, because a
    // second copy of that rule is a second thing to forget substitution in.
    LessonAccessModule,
  ],
  controllers: [AttendancesController],
  providers: [AttendancesService],
  exports: [AttendancesService, MongooseModule],
})
export class AttendancesModule {}
