import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConductScore, ConductScoreSchema } from 'src/database/schemas';
import { ClassroomsModule } from '../classrooms/classrooms.module';
import { SemestersModule } from '../semesters/semesters.module';
import { TermResultStalenessModule } from '../term-results/term-result-staleness.service';
import { ConductScoresController } from './conduct-scores.controller';
import { ConductScoresService } from './conduct-scores.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ConductScore.name, schema: ConductScoreSchema }]),
    SemestersModule,
    ClassroomsModule,
    // The conduct grade is printed on the report card, so a change dates it.
    TermResultStalenessModule,
  ],
  controllers: [ConductScoresController],
  providers: [ConductScoresService],
  exports: [ConductScoresService, MongooseModule],
})
export class ConductScoresModule {}
