import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Score, ScoreComponent, ScoreComponentSchema, ScoreSchema } from 'src/database/schemas';
import { SemestersModule } from '../semesters/semesters.module';
import { SubjectsModule } from '../subjects/subjects.module';
import { ScoreComponentsController } from './score-components.controller';
import { ScoreComponentsService } from './score-components.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ScoreComponent.name, schema: ScoreComponentSchema },
      // Needed to check whether scores already exist before allowing edits.
      { name: Score.name, schema: ScoreSchema },
    ]),
    SubjectsModule,
    SemestersModule,
  ],
  controllers: [ScoreComponentsController],
  providers: [ScoreComponentsService],
  exports: [ScoreComponentsService, MongooseModule],
})
export class ScoreComponentsModule {}
