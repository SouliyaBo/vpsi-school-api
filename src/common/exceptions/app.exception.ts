import { HttpException, HttpStatus } from '@nestjs/common';
import { MessageKey } from '../i18n/messages';

/**
 * Domain error carrying a message *key* rather than a rendered string.
 *
 * Services throw these without knowing the caller's language; the exception
 * filter resolves the key against the request locale at the edge. That keeps
 * every service free of request context and makes the message set exhaustive
 * and type-checked.
 */
export class AppException extends HttpException {
  constructor(
    readonly messageKey: MessageKey,
    status: HttpStatus,
    /** Extra machine-readable context, e.g. `{ conflictingAssignmentId }`. */
    readonly details?: Record<string, unknown>,
  ) {
    super(messageKey, status);
  }

  static notFound(key: MessageKey = 'common.notFound', details?: Record<string, unknown>) {
    return new AppException(key, HttpStatus.NOT_FOUND, details);
  }

  static badRequest(key: MessageKey, details?: Record<string, unknown>) {
    return new AppException(key, HttpStatus.BAD_REQUEST, details);
  }

  static conflict(key: MessageKey, details?: Record<string, unknown>) {
    return new AppException(key, HttpStatus.CONFLICT, details);
  }

  static forbidden(key: MessageKey = 'auth.forbidden', details?: Record<string, unknown>) {
    return new AppException(key, HttpStatus.FORBIDDEN, details);
  }

  static unauthorized(key: MessageKey = 'auth.unauthenticated', details?: Record<string, unknown>) {
    return new AppException(key, HttpStatus.UNAUTHORIZED, details);
  }

  static unprocessable(key: MessageKey, details?: Record<string, unknown>) {
    return new AppException(key, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
}
