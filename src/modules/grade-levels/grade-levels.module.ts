import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GradeLevel, GradeLevelSchema } from 'src/database/schemas';
import { GradeLevelsController } from './grade-levels.controller';
import { GradeLevelsService } from './grade-levels.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: GradeLevel.name, schema: GradeLevelSchema }])],
  controllers: [GradeLevelsController],
  providers: [GradeLevelsService],
  exports: [GradeLevelsService, MongooseModule],
})
export class GradeLevelsModule {}
