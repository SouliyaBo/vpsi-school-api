import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  GradeLevel,
  GradeLevelSchema,
  Classroom,
  ClassroomSchema,
  LessonPlan,
  LessonPlanMonth,
  LessonPlanMonthSchema,
  LessonPlanSchema,
  LessonPlanTask,
  LessonPlanTaskSchema,
  Semester,
  SemesterSchema,
  Subject,
  SubjectGroup,
  SubjectGroupSchema,
  SubjectSchema,
  Teacher,
  TeacherSchema,
  TeachingAssignment,
  TeachingAssignmentSchema,
} from 'src/database/schemas';
import {
  LessonPlanMonthsController,
  LessonPlanTasksController,
} from './lesson-plan-tasks.controller';
import { LessonPlanTasksService } from './lesson-plan-tasks.service';
import { LessonPlansController } from './lesson-plans.controller';
import { LessonPlansService } from './lesson-plans.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LessonPlan.name, schema: LessonPlanSchema },
      // The academic office's editable answer to "what is owed this month", and
      // its lines. Kept in this module because a line is answered by a plan.
      { name: LessonPlanMonth.name, schema: LessonPlanMonthSchema },
      { name: LessonPlanTask.name, schema: LessonPlanTaskSchema },
      // Needed to resolve the calling teacher and to find the academic heads.
      { name: Teacher.name, schema: TeacherSchema },
      // The compliance matrix's axes: the semester supplies the weeks, the
      // timetable supplies the rows, and the subject supplies the department the
      // rows are grouped and routed by.
      { name: Semester.name, schema: SemesterSchema },
      { name: TeachingAssignment.name, schema: TeachingAssignmentSchema },
      { name: Subject.name, schema: SubjectSchema },
      { name: SubjectGroup.name, schema: SubjectGroupSchema },
      // Registered only so `populate` can resolve a row's class label — never
      // queried directly here.
      { name: Classroom.name, schema: ClassroomSchema },
      { name: GradeLevel.name, schema: GradeLevelSchema },
    ]),
  ],
  controllers: [LessonPlansController, LessonPlanMonthsController, LessonPlanTasksController],
  providers: [LessonPlansService, LessonPlanTasksService],
  exports: [LessonPlansService],
})
export class LessonPlansModule {}
