import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** What Telegram answers to every Bot API call. */
interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number; type: string };
    from?: { id: number; first_name?: string; username?: string };
    text?: string;
  };
}

/**
 * Talking to the Telegram Bot API.
 *
 * Plain `fetch` rather than a client library: two calls are used — `sendMessage`
 * and `getUpdates` — and a dependency that wraps them would be more code to keep
 * current than the two URLs.
 *
 * Long polling, not a webhook. Telegram will only deliver a webhook over HTTPS,
 * and this API is served over plain HTTP on port 3000; polling reaches out from
 * the server instead, so it needs nothing inbound and no certificate.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly token: string;

  constructor(private readonly config: ConfigService) {
    this.token = this.config.get<string>('TELEGRAM_BOT_TOKEN') ?? '';
  }

  /** Whether there is a bot to talk to at all. */
  get enabled(): boolean {
    return this.token.length > 0;
  }

  /**
   * Sends one message, and reports whether it arrived.
   *
   * Never throws. A notification is written to the database first and delivered
   * second: a bot that is down, a person who has blocked it, or a chat id that
   * has gone stale must not fail the thing that raised the notification —
   * publishing a set of marks cannot depend on Telegram being reachable.
   */
  async sendMessage(chatId: string, text: string): Promise<boolean> {
    if (!this.enabled) return false;

    const response = await this.call<{ message_id: number }>('sendMessage', {
      chat_id: chatId,
      text,
      // HTML rather than Markdown: the school's text is Lao with the occasional
      // underscore and asterisk in it, and Markdown would either mangle it or
      // fail the whole send on an unbalanced character.
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });

    if (!response?.ok) {
      // 403 is the ordinary case of somebody blocking the bot, not an incident.
      const level = response?.error_code === 403 ? 'log' : 'warn';
      this.logger[level](
        `sendMessage to ${chatId} failed: ${response?.description ?? 'no response'}`,
      );
      return false;
    }
    return true;
  }

  /**
   * The updates waiting for the bot.
   *
   * `offset` is the acknowledgement: passing the last id seen plus one is what
   * tells Telegram the earlier ones are dealt with and must not be sent again.
   */
  async getUpdates(offset: number, timeoutSeconds: number): Promise<TelegramUpdate[]> {
    if (!this.enabled) return [];

    const response = await this.call<TelegramUpdate[]>(
      'getUpdates',
      {
        offset,
        timeout: timeoutSeconds,
        // Only private messages matter; the bot is not in any group.
        allowed_updates: ['message'],
      },
      // The request hangs for `timeout` seconds by design, so the client must
      // outlast it rather than cancelling every poll.
      (timeoutSeconds + 10) * 1000,
    );

    if (!response?.ok) {
      this.logger.warn(`getUpdates failed: ${response?.description ?? 'no response'}`);
      return [];
    }
    return response.result ?? [];
  }

  private async call<T>(
    method: string,
    body: Record<string, unknown>,
    timeoutMs = 15_000,
  ): Promise<TelegramResponse<T> | null> {
    const abort = AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abort,
      });
      return (await response.json()) as TelegramResponse<T>;
    } catch (error) {
      // A network blip on a poll is normal and the loop simply tries again; it
      // is logged at debug so a week of them does not bury anything real.
      this.logger.debug(`${method}: ${(error as Error).message}`);
      return null;
    }
  }
}
