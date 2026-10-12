import { Module } from '@nestjs/common';
import { LessonAccessModule } from 'src/common/lesson-access/lesson-access.service';
import { CalendarModule } from '../calendar/calendar.module';
import { SemestersModule } from '../semesters/semesters.module';
import { TeachersModule } from '../teachers/teachers.module';
import { LessonSubstitutionsController } from './lesson-substitutions.controller';
import { LessonSubstitutionsService } from './lesson-substitutions.service';

@Module({
  imports: [
    // Owns the LessonSubstitution and TeachingAssignment models, and the rule that
    // decides who may write a lesson — so a claim is validated against the same
    // timetable read the roll call authorizes itself with.
    LessonAccessModule,
    // The claim window is the lesson's own paperwork deadline, which is the next
    // *working* day — a calendar question, not an arithmetic one.
    CalendarModule,
    SemestersModule,
    // The named stand-in has to be a teacher still on the register.
    TeachersModule,
  ],
  controllers: [LessonSubstitutionsController],
  providers: [LessonSubstitutionsService],
  exports: [LessonSubstitutionsService],
})
export class LessonSubstitutionsModule {}
