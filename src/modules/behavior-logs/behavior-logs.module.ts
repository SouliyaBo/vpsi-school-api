import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BehaviorLog, BehaviorLogSchema } from 'src/database/schemas';
import { ClassroomsModule } from '../classrooms/classrooms.module';
import { CalendarModule } from '../calendar/calendar.module';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { SemestersModule } from '../semesters/semesters.module';
import { TeachingAssignmentsModule } from '../teaching-assignments/teaching-assignments.module';
import { BehaviorLogsController } from './behavior-logs.controller';
import { BehaviorLogsService } from './behavior-logs.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: BehaviorLog.name, schema: BehaviorLogSchema }]),
    // For the Enrollment model: a row may only name students on the active roster.
    // The school calendar, which decides which days a lesson was owed on.
    CalendarModule,
    EnrollmentsModule,
    SemestersModule,
    // For the TeachingAssignment model: every row is anchored to a lesson, which
    // is resolved and authorized before anything is written.
    TeachingAssignmentsModule,
    // The monthly sheet's header is `ມ.1/ກ` plus the homeroom teacher.
    ClassroomsModule,
  ],
  controllers: [BehaviorLogsController],
  providers: [BehaviorLogsService],
  exports: [BehaviorLogsService, MongooseModule],
})
export class BehaviorLogsModule {}
