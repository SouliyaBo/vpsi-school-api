import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PERMISSIONS_KEY, RequiredPermission } from '../decorators';
import { AppException } from '../exceptions/app.exception';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/**
 * Enforces the permission matrix declared by `@RequirePermissions()`.
 *
 * `manage` on a resource implies every action on it, which keeps admin-style
 * roles from having to enumerate all seven actions per resource.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RequiredPermission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No declared requirement means the route is authenticated but unrestricted
    // (e.g. "my own profile"), not that it is open.
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) throw AppException.unauthorized();

    const missing = required.filter(({ resource, action }) => {
      const grant = user.permissions.find((p) => p.resource === resource);
      if (!grant) return true;
      return !grant.actions.includes(action) && !grant.actions.includes('manage');
    });

    if (missing.length > 0) {
      throw AppException.forbidden('auth.forbidden', {
        required: missing.map((m) => `${m.resource}:${m.action}`),
      });
    }

    return true;
  }
}
