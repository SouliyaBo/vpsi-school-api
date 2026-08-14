import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Subject, SubjectSchema } from 'src/database/schemas';
import { GradeLevelsModule } from '../grade-levels/grade-levels.module';
import { SubjectGroupsModule } from '../subject-groups/subject-groups.module';
import { SubjectsController } from './subjects.controller';
import { SubjectsService } from './subjects.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Subject.name, schema: SubjectSchema }]),
    GradeLevelsModule,
    SubjectGroupsModule,
  ],
  controllers: [SubjectsController],
  providers: [SubjectsService],
  exports: [SubjectsService, MongooseModule],
})
export class SubjectsModule {}
