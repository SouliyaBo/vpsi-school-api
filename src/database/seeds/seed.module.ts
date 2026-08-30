import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CalendarEvent,
  CalendarEventSchema,
  Classroom,
  ClassroomSchema,
  ConductRule,
  ConductRuleSchema,
  GradeLevel,
  GradeLevelSchema,
  ReportTemplate,
  ReportTemplateSchema,
  Location,
  LocationSchema,
  Role,
  RoleSchema,
  SchoolYear,
  SchoolYearSchema,
  Semester,
  SemesterSchema,
  Setting,
  SettingSchema,
  Subject,
  SubjectGroup,
  SubjectGroupSchema,
  SubjectSchema,
  Teacher,
  TeacherSchema,
  User,
  UserSchema,
} from 'src/database/schemas';
import { SeedService } from './seed.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Role.name, schema: RoleSchema },
      { name: User.name, schema: UserSchema },
      { name: Location.name, schema: LocationSchema },
      { name: SchoolYear.name, schema: SchoolYearSchema },
      { name: Semester.name, schema: SemesterSchema },
      { name: GradeLevel.name, schema: GradeLevelSchema },
      { name: SubjectGroup.name, schema: SubjectGroupSchema },
      { name: Subject.name, schema: SubjectSchema },
      { name: Classroom.name, schema: ClassroomSchema },
      { name: Teacher.name, schema: TeacherSchema },
      { name: Setting.name, schema: SettingSchema },
      { name: ReportTemplate.name, schema: ReportTemplateSchema },
      { name: CalendarEvent.name, schema: CalendarEventSchema },
      { name: ConductRule.name, schema: ConductRuleSchema },
    ]),
  ],
  providers: [SeedService],
  exports: [SeedService],
})
export class SeedModule {}
