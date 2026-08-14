import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Announcement,
  AnnouncementSchema,
  Enrollment,
  EnrollmentSchema,
} from 'src/database/schemas';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Announcement.name, schema: AnnouncementSchema },
      // Needed to expand classroom and grade-level targets into an audience.
      { name: Enrollment.name, schema: EnrollmentSchema },
    ]),
  ],
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService],
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
