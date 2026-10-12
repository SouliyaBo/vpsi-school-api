import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Classroom,
  ClassroomSchema,
  Teacher,
  TeacherSchema,
  TeachingAssignment,
  TeachingAssignmentSchema,
} from 'src/database/schemas';
import { LocationsModule } from '../locations/locations.module';
import { SchoolYearsModule } from '../school-years/school-years.module';
import { SubjectGroupsModule } from '../subject-groups/subject-groups.module';
import { TeachersController } from './teachers.controller';
import { TeachersService } from './teachers.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Teacher.name, schema: TeacherSchema },
      // The posts a departing teacher leaves vacant — see `commitments`. Declared
      // here rather than imported from the modules that own them, both of which
      // import this one.
      { name: TeachingAssignment.name, schema: TeachingAssignmentSchema },
      { name: Classroom.name, schema: ClassroomSchema },
    ]),
    // Provides the Location model used for village validation and ancestry filters.
    LocationsModule,
    // Provides the SchoolYear model that `T-2627-001` takes its year from.
    SchoolYearsModule,
    // Validates `subjectGroupId` against a group that actually exists.
    SubjectGroupsModule,
  ],
  controllers: [TeachersController],
  providers: [TeachersService],
  exports: [TeachersService, MongooseModule],
})
export class TeachersModule {}
