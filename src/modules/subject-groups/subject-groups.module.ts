import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Subject,
  SubjectGroup,
  SubjectGroupSchema,
  SubjectSchema,
  Teacher,
  TeacherSchema,
} from 'src/database/schemas';
import { SubjectGroupsController } from './subject-groups.controller';
import { SubjectGroupsService } from './subject-groups.service';

@Module({
  imports: [
    // `Subject` and `Teacher` are registered here rather than imported from
    // their own modules: SubjectsModule already depends on this one (to validate
    // `subjectGroupId`), so importing it back would be a cycle.
    MongooseModule.forFeature([
      { name: SubjectGroup.name, schema: SubjectGroupSchema },
      { name: Subject.name, schema: SubjectSchema },
      { name: Teacher.name, schema: TeacherSchema },
    ]),
  ],
  controllers: [SubjectGroupsController],
  providers: [SubjectGroupsService],
  exports: [SubjectGroupsService, MongooseModule],
})
export class SubjectGroupsModule {}
