import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { TelegramLinkCodeDto, TelegramLinkStatusDto } from './dto/telegram.dto';
import { TelegramLinkService } from './telegram-link.service';
import { TelegramService } from './telegram.service';

/**
 * Connecting one's own account to the bot.
 *
 * Deliberately not behind a `@RequirePermissions` resource: every one of these
 * acts on the signed-in account and nobody else's, which is the same reason
 * changing one's own password needs no permission. A permission here would mean
 * the office could switch a colleague's notifications off, which is not a thing
 * anybody asked for.
 */
@ApiTags('telegram')
@ApiBearerAuth()
@Controller('telegram')
export class TelegramController {
  constructor(
    private readonly links: TelegramLinkService,
    private readonly telegram: TelegramService,
    private readonly config: ConfigService,
  ) {}

  @Get('link')
  @ApiOperation({ summary: 'Whether this account receives Telegram notifications' })
  async status(@CurrentUser() actor: AuthenticatedUser): Promise<TelegramLinkStatusDto> {
    return { available: this.telegram.enabled, ...(await this.links.status(actor.sub)) };
  }

  @Post('link')
  @ApiOperation({
    summary: 'Issue a one-time code for this account',
    description:
      'The person sends it to the bot as `/start <code>`, or follows `deepLink`, which fills ' +
      'it in for them. Valid for fifteen minutes, single use, and asking again replaces it.',
  })
  async issue(@CurrentUser() actor: AuthenticatedUser): Promise<TelegramLinkCodeDto> {
    const { code, expiresAt } = await this.links.issueCode(actor.sub);
    const botUsername = this.config.get<string>('TELEGRAM_BOT_USERNAME') ?? '';

    return {
      available: this.telegram.enabled,
      ...(await this.links.status(actor.sub)),
      code,
      expiresAt: expiresAt.toISOString(),
      deepLink: botUsername ? `https://t.me/${botUsername}?start=${code}` : null,
    };
  }

  @Delete('link')
  @ApiOperation({
    summary: 'Stop delivering to this account’s chat',
    description: 'The chat is left alone — blocking the bot is the person’s own call.',
  })
  async unlink(@CurrentUser() actor: AuthenticatedUser): Promise<{ unlinked: true }> {
    await this.links.unlink(actor.sub);
    return { unlinked: true };
  }

  @Post('test')
  @ApiOperation({
    summary: 'Send this account a test message',
    description: 'The one way to be sure a link works before relying on it for a reminder.',
  })
  async test(@CurrentUser() actor: AuthenticatedUser, @Body() _body: unknown) {
    const chats = await this.links.chatIdsFor([actor.sub]);
    const chatId = chats.get(actor.sub);
    if (!chatId) return { sent: false, reason: 'not-linked' as const };

    const sent = await this.telegram.sendMessage(
      chatId,
      '🔔 <b>ທົດສອບ</b>\nແຈ້ງເຕືອນຈາກລະບົບໂຮງຮຽນ VPSI ເຮັດວຽກປົກກະຕິ\n\nTest message — notifications are working.',
    );
    return { sent };
  }
}
