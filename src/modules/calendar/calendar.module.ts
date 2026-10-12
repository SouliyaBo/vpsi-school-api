import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CalendarEvent,
  CalendarEventSchema,
  Classroom,
  ClassroomSchema,
} from 'src/database/schemas';
import { SchoolYearsModule } from '../school-years/school-years.module';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CalendarEvent.name, schema: CalendarEventSchema },
      // Resolves a classroom to its grade level, so a grade-level closure
      // reaches the rooms inside it.
      { name: Classroom.name, schema: ClassroomSchema },
    ]),
    SchoolYearsModule,
  ],
  controllers: [CalendarController],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
