import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Semester, SemesterSchema } from 'src/database/schemas';
import { SchoolYearsModule } from '../school-years/school-years.module';
import { SemestersController } from './semesters.controller';
import { SemestersService } from './semesters.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Semester.name, schema: SemesterSchema }]),
    SchoolYearsModule,
  ],
  controllers: [SemestersController],
  providers: [SemestersService],
  exports: [SemestersService, MongooseModule],
})
export class SemestersModule {}
