import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Classroom, ClassroomSchema } from 'src/database/schemas';
import { GradeLevelsModule } from '../grade-levels/grade-levels.module';
import { SchoolYearsModule } from '../school-years/school-years.module';
import { TeachersModule } from '../teachers/teachers.module';
import { ClassroomsController } from './classrooms.controller';
import { ClassroomsService } from './classrooms.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Classroom.name, schema: ClassroomSchema }]),
    SchoolYearsModule,
    GradeLevelsModule,
    TeachersModule,
  ],
  controllers: [ClassroomsController],
  providers: [ClassroomsService],
  exports: [ClassroomsService, MongooseModule],
})
export class ClassroomsModule {}
