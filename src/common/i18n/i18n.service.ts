import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AppConfig } from 'src/config/configuration';
import { isSupportedLocale, Locale, MESSAGES, MessageKey } from './messages';

@Injectable()
export class I18nService {
  private readonly defaultLocale: Locale;

  constructor(config: ConfigService<AppConfig, true>) {
    const configured = config.get('DEFAULT_LOCALE', { infer: true });
    this.defaultLocale = isSupportedLocale(configured) ? configured : 'lo';
  }

  translate(key: MessageKey, locale?: Locale): string {
    return MESSAGES[key][locale ?? this.defaultLocale];
  }

  /** Both locales at once, so clients can render either without a second call. */
  translateAll(key: MessageKey): Record<Locale, string> {
    return { lo: MESSAGES[key].lo, en: MESSAGES[key].en };
  }

  /**
   * Resolves the locale for a request.
   *
   * Order: `?lang=` (explicit and easy to test) → `Accept-Language` → default.
   * Only the first tag of `Accept-Language` is considered; quality values are
   * ignored because there are only two supported locales.
   */
  resolveLocale(request: Request): Locale {
    const query = request.query?.lang;
    if (isSupportedLocale(query)) return query;

    const header = request.headers?.['accept-language'];
    if (typeof header === 'string') {
      const primary = header.split(',')[0]?.trim().split('-')[0];
      if (isSupportedLocale(primary)) return primary;
    }

    return this.defaultLocale;
  }
}
