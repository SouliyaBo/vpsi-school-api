import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from 'src/database/schemas';
import { TelegramController } from './telegram.controller';
import { TelegramLinkService } from './telegram-link.service';
import { TelegramPollerService } from './telegram-poller.service';
import { TelegramService } from './telegram.service';

/**
 * Delivery over Telegram.
 *
 * `@Global` because notifications are raised all over the system and a delivery
 * channel that every module has to import is a channel somebody will forget to
 * wire up. It exports the two services and nothing else; the poller is internal
 * and starts itself in the worker.
 */
@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  controllers: [TelegramController],
  providers: [TelegramService, TelegramLinkService, TelegramPollerService],
  exports: [TelegramService, TelegramLinkService],
})
export class TelegramModule {}
