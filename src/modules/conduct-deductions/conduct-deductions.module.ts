import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ConductDeduction,
  ConductDeductionSchema,
  ConductRule,
  ConductRuleSchema,
} from 'src/database/schemas';
import { ClassroomsModule } from '../classrooms/classrooms.module';
import { ConductScoresModule } from '../conduct-scores/conduct-scores.module';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { SemestersModule } from '../semesters/semesters.module';
import { ConductDeductionsController } from './conduct-deductions.controller';
import { ConductDeductionsService } from './conduct-deductions.service';
import { ConductRulesController } from './conduct-rules.controller';
import { ConductRulesService } from './conduct-rules.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ConductRule.name, schema: ConductRuleSchema },
      { name: ConductDeduction.name, schema: ConductDeductionSchema },
    ]),
    // For the Enrollment model: points are taken against the class roll.
    EnrollmentsModule,
    // The term is resolved from the date the rule was broken.
    SemestersModule,
    ClassroomsModule,
    // The balance is published as the term's conduct score.
    ConductScoresModule,
  ],
  controllers: [ConductRulesController, ConductDeductionsController],
  providers: [ConductRulesService, ConductDeductionsService],
  exports: [ConductDeductionsService, MongooseModule],
})
export class ConductDeductionsModule {}
