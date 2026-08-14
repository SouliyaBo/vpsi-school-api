import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { PermissionAction, PermissionResource } from '../constants/enums';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

// ── Route metadata ──────────────────────────────────────────────────────────

export const IS_PUBLIC_KEY = 'isPublic';

/** Opts a route out of JwtAuthGuard. Everything else requires a valid token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'requiredPermissions';

export interface RequiredPermission {
  resource: PermissionResource;
  action: PermissionAction;
}

/**
 * Declares what a route needs. Multiple entries are ANDed.
 *
 * The `resource` type is the `PERMISSION_RESOURCES` union, so a mistyped
 * resource name is a compile error rather than a permission that silently
 * never matches.
 */
export const RequirePermissions = (...permissions: RequiredPermission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const ALLOW_PASSWORD_CHANGE_KEY = 'allowWhilePasswordChangeRequired';

/**
 * Lets a route stay reachable for a user flagged `mustChangePassword`.
 * Only the change-password and logout routes should use this.
 */
export const AllowWhilePasswordChangeRequired = () => SetMetadata(ALLOW_PASSWORD_CHANGE_KEY, true);

export const AUDIT_KEY = 'auditAction';

export interface AuditMetadata {
  entityType: string;
  action: 'create' | 'update' | 'delete' | 'approve' | 'reject' | 'export' | 'lock' | 'unlock';
}

/** Marks a route for automatic audit logging by AuditInterceptor. */
export const Audited = (metadata: AuditMetadata) => SetMetadata(AUDIT_KEY, metadata);

// ── Param decorators ────────────────────────────────────────────────────────

/**
 * Injects the authenticated user, or one property of it.
 *
 * `@CurrentUser('sub')` is common enough to be worth the overload.
 */
export const CurrentUser = createParamDecorator(
  (property: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) return undefined;
    return property ? user[property] : user;
  },
);

/** Resolves the request locale the same way the exception filter does. */
export const ReqLocale = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<Request>();
  const query = request.query?.lang;
  if (query === 'lo' || query === 'en') return query;
  const header = request.headers?.['accept-language'];
  if (typeof header === 'string') {
    const primary = header.split(',')[0]?.trim().split('-')[0];
    if (primary === 'lo' || primary === 'en') return primary;
  }
  return 'lo';
});

/** Client IP, honouring the proxy chain when `trust proxy` is enabled. */
export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<Request>();
  return request.ip ?? request.socket?.remoteAddress ?? null;
});
