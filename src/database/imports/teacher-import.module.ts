import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Location,
  LocationSchema,
  SchoolYear,
  SchoolYearSchema,
  Teacher,
  TeacherSchema,
} from 'src/database/schemas';
import { TeacherImportService } from './teacher-import.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Teacher.name, schema: TeacherSchema },
      { name: Location.name, schema: LocationSchema },
      // The year a generated code belongs to — `T-2627-001` for 2026-2027.
      { name: SchoolYear.name, schema: SchoolYearSchema },
    ]),
  ],
  providers: [TeacherImportService],
  exports: [TeacherImportService],
})
export class TeacherImportModule {}
