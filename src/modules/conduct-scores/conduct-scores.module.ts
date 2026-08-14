import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConductScore, ConductScoreSchema } from 'src/database/schemas';
import { ClassroomsModule } from '../classrooms/classrooms.module';
import { SemestersModule } from '../semesters/semesters.module';
import { ConductScoresController } from './conduct-scores.controller';
import { ConductScoresService } from './conduct-scores.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ConductScore.name, schema: ConductScoreSchema }]),
    SemestersModule,
    ClassroomsModule,
  ],
  controllers: [ConductScoresController],
  providers: [ConductScoresService],
  exports: [ConductScoresService, MongooseModule],
})
export class ConductScoresModule {}
