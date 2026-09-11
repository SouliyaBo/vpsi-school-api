import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TermResult, TermResultSchema } from 'src/database/schemas';
import { AttendancesModule } from '../attendances/attendances.module';
import { ClassroomsModule } from '../classrooms/classrooms.module';
import { ConductScoresModule } from '../conduct-scores/conduct-scores.module';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { MonthlyMarksModule } from '../monthly-marks/monthly-marks.module';
import { ScoreComponentsModule } from '../score-components/score-components.module';
import { ScoresModule } from '../scores/scores.module';
import { SubjectsModule } from '../subjects/subjects.module';
import { GradingScaleModule } from './grading-scale.service';
import { TermResultsController } from './term-results.controller';
import {
  TERM_RESULTS_QUEUE,
  TermResultsProcessor,
  TermResultsQueueService,
} from './term-results.queue';
import { TermResultsService } from './term-results.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: TermResult.name, schema: TermResultSchema }]),
    BullModule.registerQueue({ name: TERM_RESULTS_QUEUE }),
    // Provide the Score, Enrollment and Subject models plus the collaborating services.
    ScoresModule,
    EnrollmentsModule,
    ScoreComponentsModule,
    SubjectsModule,
    // The grade level a class sits decides how many subjects the average divides by.
    ClassroomsModule,
    // The school's letter bands, shared with the monthly summary.
    GradingScaleModule,
    ConductScoresModule,
    AttendancesModule,
    // The school's own 10-point sheet, which most subjects are marked on.
    MonthlyMarksModule,
  ],
  controllers: [TermResultsController],
  providers: [TermResultsService, TermResultsQueueService, TermResultsProcessor],
  exports: [TermResultsService, TermResultsQueueService],
})
export class TermResultsModule {}
