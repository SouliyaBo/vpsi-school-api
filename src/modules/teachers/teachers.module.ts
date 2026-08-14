import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Teacher, TeacherSchema } from 'src/database/schemas';
import { LocationsModule } from '../locations/locations.module';
import { SchoolYearsModule } from '../school-years/school-years.module';
import { SubjectGroupsModule } from '../subject-groups/subject-groups.module';
import { TeachersController } from './teachers.controller';
import { TeachersService } from './teachers.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Teacher.name, schema: TeacherSchema }]),
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
