import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomInt } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { AppException } from 'src/common/exceptions/app.exception';
import { User, UserDocument } from 'src/database/schemas';

/** How long a link code is worth sending. */
const CODE_TTL_MINUTES = 15;

/**
 * Six digits, from a cryptographic source.
 *
 * Typed on a phone by somebody standing in a staff meeting, so it is short and
 * numeric rather than a token. What keeps that safe is the fifteen minutes it
 * lives and the single account it belongs to: guessing it wins the right to be
 * notified, not the right to read anything.
 */
function newCode(): string {
  return String(randomInt(100_000, 1_000_000));
}

export interface TelegramLinkStatus {
  /** Whether the school has a bot configured at all. */
  available: boolean;
  linked: boolean;
  linkedAt: string | null;
  botUsername: string | null;
}

/**
 * Tying a Telegram chat to an account.
 *
 * The bot cannot know who is writing to it — anybody can find it and press
 * Start — so the person proves who they are by carrying a code from a screen
 * they are already signed in to. `/start 123456` is the whole handshake, and
 * Telegram puts the code in the message for them when they follow a
 * `t.me/<bot>?start=<code>` link.
 */
@Injectable()
export class TelegramLinkService {
  private readonly logger = new Logger(TelegramLinkService.name);

  constructor(@InjectModel(User.name) private readonly users: Model<UserDocument>) {}

  /**
   * Issues a code for this account, replacing any it already has.
   *
   * Replacing rather than reusing: a code left on a screen somebody walked away
   * from should stop working as soon as a new one is asked for.
   */
  async issueCode(userId: string): Promise<{ code: string; expiresAt: Date }> {
    const code = newCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);

    const user = await this.users
      .findOneAndUpdate(
        { _id: new Types.ObjectId(userId), deletedAt: null },
        { $set: { telegramLinkCode: code, telegramLinkCodeExpiresAt: expiresAt } },
      )
      .exec();
    if (!user) throw AppException.notFound();

    return { code, expiresAt };
  }

  /**
   * Spends a code, binding the chat that sent it.
   *
   * Returns the account it bound, or `null` when the code is unknown or expired
   * — the bot answers both the same way, since telling a stranger which of the
   * two it was is telling them whether a code exists.
   */
  async consumeCode(code: string, chatId: string): Promise<UserDocument | null> {
    const user = await this.users
      .findOneAndUpdate(
        {
          telegramLinkCode: code,
          telegramLinkCodeExpiresAt: { $gt: new Date() },
          deletedAt: null,
        },
        {
          $set: { telegramChatId: chatId, telegramLinkedAt: new Date() },
          // Single use, and the expiry goes with it: a spent code is not a code.
          $unset: { telegramLinkCode: '', telegramLinkCodeExpiresAt: '' },
        },
        { new: true },
      )
      .exec();

    if (user) this.logger.log(`linked ${user.username} to a Telegram chat`);
    return user;
  }

  /**
   * Stops delivery to this account's chat.
   *
   * The chat itself is left alone — the person can block the bot if they want it
   * gone from their app, which is theirs to decide and not something the school
   * should do on their behalf.
   */
  async unlink(userId: string): Promise<void> {
    await this.users
      .updateOne(
        { _id: new Types.ObjectId(userId), deletedAt: null },
        {
          $set: { telegramChatId: null, telegramLinkedAt: null },
          $unset: { telegramLinkCode: '', telegramLinkCodeExpiresAt: '' },
        },
      )
      .exec();
  }

  async status(userId: string): Promise<Pick<TelegramLinkStatus, 'linked' | 'linkedAt'>> {
    const user = await this.users
      .findOne({ _id: new Types.ObjectId(userId), deletedAt: null })
      .select('telegramChatId telegramLinkedAt')
      .lean()
      .exec();

    return {
      linked: Boolean(user?.telegramChatId),
      linkedAt: user?.telegramLinkedAt ? user.telegramLinkedAt.toISOString() : null,
    };
  }

  /** Every linked chat for a set of accounts, for a fan-out. */
  async chatIdsFor(userIds: (Types.ObjectId | string)[]): Promise<Map<string, string>> {
    const rows = await this.users
      .find({
        _id: { $in: userIds.map((id) => new Types.ObjectId(String(id))) },
        telegramChatId: { $ne: null },
        status: 'active',
        deletedAt: null,
      })
      .select('telegramChatId')
      .lean()
      .exec();

    return new Map(rows.map((row) => [String(row._id), row.telegramChatId as string]));
  }
}
