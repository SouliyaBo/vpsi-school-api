import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Classroom,
  ClassroomSchema,
  Enrollment,
  EnrollmentSchema,
  HomeroomMonthlyReport,
  HomeroomMonthlyReportSchema,
  HomeroomReview,
  HomeroomReviewSchema,
  Subject,
  SubjectSchema,
  Teacher,
  TeacherSchema,
} from 'src/database/schemas';

import { AttendancesModule } from '../attendances/attendances.module';
import { BehaviorLogsModule } from '../behavior-logs/behavior-logs.module';
import { CalendarModule } from '../calendar/calendar.module';
import { ConductDeductionsModule } from '../conduct-deductions/conduct-deductions.module';
import { MonthlyMarksModule } from '../monthly-marks/monthly-marks.module';
import { SemestersModule } from '../semesters/semesters.module';
import { HomeroomMonthlyReportDocxWriter } from './homeroom-monthly-report.docx';
import { HomeroomMonthlyReportService } from './homeroom-monthly-report.service';
import { HomeroomReviewsController } from './homeroom-reviews.controller';
import { HomeroomReviewsService } from './homeroom-reviews.service';

/**
 * ການຕິດຕາມນັກຮຽນຂອງຄູປະຈຳຫ້ອງ.
 *
 * The three fact modules are imported as modules rather than having their
 * collections read directly, which is the whole design of this one: the sheet a
 * homeroom teacher acts on must show the same numbers as the roll call, the
 * register and the discipline ledger show on their own screens, and a second
 * aggregation over the same collections is how those numbers start to disagree.
 *
 * `CalendarModule` decides which ວັນພຸດ/ວັນສຸກ a review was owed on at all — a
 * review is not owed on a day the school was shut, and without the calendar this
 * module would report the whole staff as behind for the week of ບຸນປີໃໝ່.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HomeroomReview.name, schema: HomeroomReviewSchema },
      { name: HomeroomMonthlyReport.name, schema: HomeroomMonthlyReportSchema },
      { name: Classroom.name, schema: ClassroomSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
      // ນັກຮຽນທີ່ຮຽນເພີ່ມ names a subject and a teacher picked from these lists.
      { name: Subject.name, schema: SubjectSchema },
      { name: Teacher.name, schema: TeacherSchema },
    ]),
    CalendarModule,
    SemestersModule,
    AttendancesModule,
    BehaviorLogsModule,
    ConductDeductionsModule,
    // ຮ່າງບົດສະຫຼຸບຄູປະຈຳຫ້ອງ reads ກວດກາ off the class month sheet.
    MonthlyMarksModule,
  ],
  controllers: [HomeroomReviewsController],
  providers: [
    HomeroomReviewsService,
    HomeroomMonthlyReportService,
    HomeroomMonthlyReportDocxWriter,
  ],
  exports: [HomeroomReviewsService, MongooseModule],
})
export class HomeroomReviewsModule {}
