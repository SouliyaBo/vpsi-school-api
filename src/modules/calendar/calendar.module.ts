import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CalendarEvent, CalendarEventSchema } from 'src/database/schemas';
import { SchoolYearsModule } from '../school-years/school-years.module';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: CalendarEvent.name, schema: CalendarEventSchema }]),
    SchoolYearsModule,
  ],
  controllers: [CalendarController],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
