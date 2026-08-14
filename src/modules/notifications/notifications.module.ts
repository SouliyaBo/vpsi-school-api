import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Notification,
  NotificationSchema,
  Student,
  StudentSchema,
  User,
  UserSchema,
} from 'src/database/schemas';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Global, like audit logs: most modules raise notifications, and threading an
 * import through every one of them would create a web of module dependencies
 * (and a few cycles) for no benefit.
 *
 * Declares its own User and Student models rather than importing those modules,
 * which is what keeps this module free of cycles.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: User.name, schema: UserSchema },
      { name: Student.name, schema: StudentSchema },
    ]),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
