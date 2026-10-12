import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

/**
 * Validated shape of `process.env`.
 *
 * Validation runs at bootstrap and throws on the first problem, so a
 * misconfigured deployment fails immediately instead of at the first request
 * that happens to need the missing value.
 */
export class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: string = 'development';

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  API_PREFIX: string = 'api';

  @IsIn(['lo', 'en'])
  DEFAULT_LOCALE: string = 'lo';

  @IsString()
  LOG_LEVEL: string = 'info';

  @IsString()
  @IsNotEmpty()
  MONGODB_URI: string;

  /**
   * The bot token from BotFather, or empty to run without Telegram.
   *
   * Optional on purpose: every environment that is not the school's server has
   * no bot, and a missing token must leave the rest of the system working rather
   * than refusing to boot. What it turns off is delivery — the notification is
   * still written, and still shows in the app.
   */
  /**
   * Whether the scheduled reminders run at all. Off unless switched on.
   *
   * Default off rather than on, because this is the one feature in the system
   * that reaches staff without anybody asking it to: deploying the API for an
   * unrelated change would otherwise start messaging seventeen teachers at half
   * past five, which is not a thing a deploy should be able to do by accident.
   *
   * It gates the schedule, not the code. `POST /reminders/run/:kind` still works
   * with this off, so the office can see what a reminder looks like before
   * letting it loose on a clock.
   */
  @IsBoolean()
  REMINDERS_ENABLED: boolean = false;

  @IsString()
  TELEGRAM_BOT_TOKEN: string = '';

  /**
   * The bot's @name, so the profile screen can offer a link that fills the code
   * in rather than asking somebody to type six digits into a chat window.
   *
   * Not read from `getMe` at boot: that would make starting the API depend on
   * Telegram being reachable, for a string that changes roughly never.
   */
  @IsString()
  TELEGRAM_BOT_USERNAME: string = '';

  @IsString()
  REDIS_HOST: string = 'localhost';

  @IsInt()
  REDIS_PORT: number = 6379;

  @IsString()
  REDIS_PASSWORD: string = '';

  @IsInt()
  CACHE_TTL_SECONDS: number = 300;

  // A short secret is a real vulnerability, so the length is enforced, not advised.
  @IsString()
  @MinLength(32, { message: 'JWT_ACCESS_SECRET must be at least 32 characters' })
  JWT_ACCESS_SECRET: string;

  @IsString()
  JWT_ACCESS_TTL: string = '15m';

  @IsString()
  @MinLength(32, { message: 'JWT_REFRESH_SECRET must be at least 32 characters' })
  JWT_REFRESH_SECRET: string;

  @IsString()
  JWT_REFRESH_TTL: string = '7d';

  @IsInt()
  @Min(8)
  PASSWORD_MIN_LENGTH: number = 8;

  @IsInt()
  @Min(1)
  MAX_FAILED_LOGIN_ATTEMPTS: number = 5;

  @IsInt()
  @Min(1)
  ACCOUNT_LOCK_MINUTES: number = 15;

  @IsString()
  S3_ENDPOINT: string = 'http://localhost:9000';

  @IsString()
  S3_REGION: string = 'us-east-1';

  @IsString()
  S3_BUCKET: string = 'vpsischool';

  @IsString()
  S3_ACCESS_KEY: string = '';

  @IsString()
  S3_SECRET_KEY: string = '';

  @IsBoolean()
  S3_FORCE_PATH_STYLE: boolean = true;

  @IsString()
  S3_PUBLIC_URL: string = 'http://localhost:9000';

  @IsInt()
  S3_SIGNED_URL_TTL_SECONDS: number = 900;

  @IsString()
  CORS_ORIGINS: string = '';

  @IsInt()
  THROTTLE_TTL_SECONDS: number = 60;

  @IsInt()
  THROTTLE_LIMIT: number = 120;
}

const asBoolean = (value: unknown, fallback: boolean): boolean => {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === true;
};

const asInt = (value: unknown, fallback: number): number => {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
};

export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables {
  const config = plainToInstance(EnvironmentVariables, {
    ...raw,
    PORT: asInt(raw.PORT, 3000),
    REDIS_PORT: asInt(raw.REDIS_PORT, 6379),
    CACHE_TTL_SECONDS: asInt(raw.CACHE_TTL_SECONDS, 300),
    PASSWORD_MIN_LENGTH: asInt(raw.PASSWORD_MIN_LENGTH, 8),
    MAX_FAILED_LOGIN_ATTEMPTS: asInt(raw.MAX_FAILED_LOGIN_ATTEMPTS, 5),
    ACCOUNT_LOCK_MINUTES: asInt(raw.ACCOUNT_LOCK_MINUTES, 15),
    S3_SIGNED_URL_TTL_SECONDS: asInt(raw.S3_SIGNED_URL_TTL_SECONDS, 900),
    THROTTLE_TTL_SECONDS: asInt(raw.THROTTLE_TTL_SECONDS, 60),
    THROTTLE_LIMIT: asInt(raw.THROTTLE_LIMIT, 120),
    S3_FORCE_PATH_STYLE: asBoolean(raw.S3_FORCE_PATH_STYLE, true),
    REMINDERS_ENABLED: asBoolean(raw.REMINDERS_ENABLED, false),
  });

  const errors = validateSync(config, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  if (config.NODE_ENV === 'production' && config.JWT_ACCESS_SECRET.startsWith('change-me')) {
    throw new Error('Refusing to start in production with the example JWT secrets.');
  }

  return config;
}

export type AppConfig = EnvironmentVariables;
