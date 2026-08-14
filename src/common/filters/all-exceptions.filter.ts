import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
// The driver comes from mongoose's own re-export rather than from `mongodb`
// directly. `mongodb` is not a dependency of this project — it is only ever
// present because something else pulled it in, and `npm prune --omit=dev` in the
// production image removes the hoisted copy, so importing it by name crashes the
// container at startup with `Cannot find module 'mongodb'`.
//
// It is also the more correct import: `instanceof` compares against the class
// mongoose actually throws, where a separately resolved copy of the driver would
// be a different class object and quietly never match.
import { mongo, Error as MongooseError } from 'mongoose';
import { AppException } from '../exceptions/app.exception';
import { I18nService } from '../i18n/i18n.service';
import { Locale, MessageKey } from '../i18n/messages';

/**
 * Names the field(s) that collided, without echoing the values — a duplicate
 * `nationalId` or phone number is personal data and must not be reflected back.
 */
function duplicateKeyFields(error: unknown): string[] {
  const candidate = error as {
    keyPattern?: Record<string, unknown>;
    writeErrors?: { err?: { keyPattern?: Record<string, unknown> } }[];
  };

  if (candidate?.keyPattern) return Object.keys(candidate.keyPattern);

  const fromBulk = candidate?.writeErrors
    ?.flatMap((write) => Object.keys(write?.err?.keyPattern ?? {}))
    .filter(Boolean);

  return fromBulk ?? [];
}

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  messageKey?: string;
  details?: unknown;
  path: string;
  timestamp: string;
  requestId?: string;
}

/**
 * Single exit point for every error.
 *
 * Responsibilities: translate `AppException` message keys into the caller's
 * language, map driver-level failures (duplicate key, cast error) onto sensible
 * HTTP statuses, and make sure nothing unexpected leaks an internal message or
 * stack trace to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly i18n: I18nService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const locale = this.i18n.resolveLocale(request);

    const body = this.buildBody(exception, request, locale);

    // 5xx means we did something wrong — log with the stack. 4xx is the caller's
    // problem and is logged thinly to keep noise down.
    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} → ${body.statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} → ${body.statusCode} ${body.message}`);
    }

    response.status(body.statusCode).json(body);
  }

  private buildBody(exception: unknown, request: Request, locale: Locale): ErrorBody {
    const base = {
      path: request.url,
      timestamp: new Date().toISOString(),
      requestId: (request.headers['x-request-id'] as string) ?? undefined,
    };

    if (exception instanceof AppException) {
      const status = exception.getStatus();
      return {
        ...base,
        statusCode: status,
        error: HttpStatus[status] ?? 'ERROR',
        message: this.i18n.translate(exception.messageKey, locale),
        messageKey: exception.messageKey,
        details: exception.details,
      };
    }

    // Duplicate key — surface which field collided without echoing the value,
    // which may be personal data.
    if (this.isDuplicateKeyError(exception)) {
      return {
        ...base,
        statusCode: HttpStatus.CONFLICT,
        error: 'CONFLICT',
        message: this.i18n.translate('common.duplicate', locale),
        messageKey: 'common.duplicate',
        details: { fields: duplicateKeyFields(exception) },
      };
    }

    if (exception instanceof MongooseError.CastError) {
      return {
        ...base,
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'BAD_REQUEST',
        message: this.i18n.translate('common.validationFailed', locale),
        messageKey: 'common.validationFailed',
        details: { field: exception.path, expectedType: exception.kind },
      };
    }

    if (exception instanceof MongooseError.ValidationError) {
      return {
        ...base,
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'BAD_REQUEST',
        message: this.i18n.translate('common.validationFailed', locale),
        messageKey: 'common.validationFailed',
        details: Object.values(exception.errors).map((e) => ({
          field: e.path,
          message: e.message,
        })),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      // ValidationPipe puts its field errors in `message`; keep them as details.
      const isValidationPayload =
        typeof payload === 'object' && payload !== null && 'message' in payload;

      return {
        ...base,
        statusCode: status,
        error: HttpStatus[status] ?? 'ERROR',
        message: isValidationPayload
          ? this.i18n.translate(this.keyForStatus(status), locale)
          : exception.message,
        messageKey: this.keyForStatus(status),
        details: isValidationPayload ? (payload as { message: unknown }).message : undefined,
      };
    }

    // Anything else is a bug. The client gets a generic message; the details go
    // to the log only.
    return {
      ...base,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'INTERNAL_SERVER_ERROR',
      message: this.i18n.translate('common.internalError', locale),
      messageKey: 'common.internalError',
    };
  }

  /**
   * Detects a duplicate-key violation.
   *
   * Checks the `code` structurally rather than relying on `instanceof
   * MongoServerError`: an error raised inside a transaction, or through
   * `bulkWrite`, arrives as a different driver class (`MongoBulkWriteError`,
   * `WriteConcernError`) that carries the same 11000 code. An `instanceof` test
   * alone lets those through as 500s.
   */
  private isDuplicateKeyError(e: unknown): e is mongo.MongoServerError {
    if (e instanceof mongo.MongoServerError && e.code === 11000) return true;

    const candidate = e as { code?: unknown; writeErrors?: { code?: unknown }[] } | null;
    if (!candidate || typeof candidate !== 'object') return false;
    if (candidate.code === 11000) return true;
    return Boolean(candidate.writeErrors?.some((write) => write?.code === 11000));
  }

  private keyForStatus(status: number): MessageKey {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return 'auth.unauthenticated';
      case HttpStatus.FORBIDDEN:
        return 'auth.forbidden';
      case HttpStatus.NOT_FOUND:
        return 'common.notFound';
      case HttpStatus.CONFLICT:
        return 'common.duplicate';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'common.rateLimited';
      case HttpStatus.BAD_REQUEST:
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'common.validationFailed';
      default:
        return 'common.internalError';
    }
  }
}
