import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Classroom, ClassroomSchema, Enrollment, EnrollmentSchema } from 'src/database/schemas';
import { GradeLevelsModule } from '../grade-levels/grade-levels.module';
import { SchoolYearsModule } from '../school-years/school-years.module';
import { TeachersModule } from '../teachers/teachers.module';
import { ClassroomsController } from './classrooms.controller';
import { ClassroomsService } from './classrooms.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Classroom.name, schema: ClassroomSchema },
      // Read only, to issue the next roll number off the register itself.
      { name: Enrollment.name, schema: EnrollmentSchema },
    ]),
    SchoolYearsModule,
    GradeLevelsModule,
    TeachersModule,
  ],
  controllers: [ClassroomsController],
  providers: [ClassroomsService],
  exports: [ClassroomsService, MongooseModule],
})
export class ClassroomsModule {}
