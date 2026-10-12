import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelegramLinkService } from './telegram-link.service';
import { TelegramService, type TelegramUpdate } from './telegram.service';

/** How long each poll waits for something to happen before coming back empty. */
const LONG_POLL_SECONDS = 50;

/** What the bot says, in both languages, since it speaks before anyone logs in. */
const REPLY = {
  linked:
    '✅ ເຊື່ອມຕໍ່ສຳເລັດ! ຈາກນີ້ໄປ ແຈ້ງເຕືອນຈາກລະບົບໂຮງຮຽນຈະສົ່ງມາທາງນີ້\n\n' +
    'Linked. School notifications will arrive here from now on.',
  badCode:
    '❌ ລະຫັດບໍ່ຖືກຕ້ອງ ຫຼື ໝົດອາຍຸແລ້ວ — ກະລຸນາເອົາລະຫັດໃໝ່ຈາກໜ້າ "ໂປຣໄຟລ໌" ໃນລະບົບ\n\n' +
    'That code is wrong or has expired. Get a new one from your profile page.',
  noCode:
    'ສະບາຍດີ! ເພື່ອຮັບແຈ້ງເຕືອນ ໃຫ້ເປີດລະບົບໂຮງຮຽນ → ໂປຣໄຟລ໌ → ເຊື່ອມຕໍ່ Telegram ' +
    'ແລ້ວກົດລິ້ງ ຫຼື ສົ່ງ /start ພ້ອມລະຫັດ 6 ຕົວເລກ\n\n' +
    'To receive notifications, open the school system → Profile → Connect Telegram.',
} as const;

/**
 * The bot's ear: reads what people send it and links the ones carrying a code.
 *
 * Runs in the worker container only. Telegram hands each update to exactly one
 * reader, so two processes polling the same bot would each see half of them —
 * and the half that went to the wrong process would be dropped. The worker is
 * the single long-running process this system already has.
 *
 * The loop is deliberately unkillable by a bad update: anything thrown while
 * handling one is logged and the offset still advances, or the same message
 * would be redelivered for ever and no one could link again.
 */
@Injectable()
export class TelegramPollerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TelegramPollerService.name);
  private offset = 0;
  private running = false;

  constructor(
    private readonly telegram: TelegramService,
    private readonly links: TelegramLinkService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.telegram.enabled) {
      this.logger.log('no TELEGRAM_BOT_TOKEN — the bot is off');
      return;
    }
    if (this.config.get<string>('WORKER_MODE') !== 'true') {
      this.logger.log('not the worker — leaving the polling to it');
      return;
    }

    this.running = true;
    void this.loop();
    this.logger.log('listening for /start');
  }

  onApplicationShutdown(): void {
    this.running = false;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const updates = await this.telegram.getUpdates(this.offset, LONG_POLL_SECONDS);
      for (const update of updates) {
        this.offset = Math.max(this.offset, update.update_id + 1);
        try {
          await this.handle(update);
        } catch (error) {
          this.logger.error(`update ${update.update_id}: ${(error as Error).message}`);
        }
      }
    }
  }

  private async handle(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    // Private chats only. The bot is not meant to sit in a staff group, where
    // everyone would read everyone else's notifications.
    if (!message?.text || message.chat.type !== 'private') return;

    const chatId = String(message.chat.id);
    const [command, argument] = message.text.trim().split(/\s+/, 2);

    if (command !== '/start') {
      await this.telegram.sendMessage(chatId, REPLY.noCode);
      return;
    }

    if (!argument) {
      await this.telegram.sendMessage(chatId, REPLY.noCode);
      return;
    }

    const user = await this.links.consumeCode(argument, chatId);
    await this.telegram.sendMessage(chatId, user ? REPLY.linked : REPLY.badCode);
  }
}
