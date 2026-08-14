import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Score, ScoreSchema } from 'src/database/schemas';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { ScoreComponentsModule } from '../score-components/score-components.module';
import { SemestersModule } from '../semesters/semesters.module';
import { TeachingAssignmentsModule } from '../teaching-assignments/teaching-assignments.module';
import { ScoresController } from './scores.controller';
import { ScoresService } from './scores.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Score.name, schema: ScoreSchema }]),
    ScoreComponentsModule,
    // Provides the Enrollment model used for roster and enrollment checks.
    EnrollmentsModule,
    TeachingAssignmentsModule,
    SemestersModule,
  ],
  controllers: [ScoresController],
  providers: [ScoresService],
  exports: [ScoresService, MongooseModule],
})
export class ScoresModule {}
