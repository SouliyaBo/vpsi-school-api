import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  BookCountSheet,
  BookCountSheetSchema,
  BookLoan,
  BookLoanSchema,
  BookTitle,
  BookTitleSchema,
  GradeLevel,
  GradeLevelSchema,
  Student,
  StudentSchema,
  Teacher,
  TeacherSchema,
  WorkbookSaleSheet,
  WorkbookSaleSheetSchema,
} from 'src/database/schemas';
import { SchoolYearsModule } from '../school-years/school-years.module';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';

/**
 * ຄັງປື້ມ. Grade levels, teachers and students are registered here only to be
 * read — the sheets' columns and the names a loan is filed against.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BookCountSheet.name, schema: BookCountSheetSchema },
      { name: BookTitle.name, schema: BookTitleSchema },
      { name: BookLoan.name, schema: BookLoanSchema },
      { name: WorkbookSaleSheet.name, schema: WorkbookSaleSheetSchema },
      { name: GradeLevel.name, schema: GradeLevelSchema },
      { name: Teacher.name, schema: TeacherSchema },
      { name: Student.name, schema: StudentSchema },
    ]),
    SchoolYearsModule,
  ],
  controllers: [LibraryController],
  providers: [LibraryService],
})
export class LibraryModule {}
