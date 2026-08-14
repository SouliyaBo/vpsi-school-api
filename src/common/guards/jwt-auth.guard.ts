import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';
import { ALLOW_PASSWORD_CHANGE_KEY, IS_PUBLIC_KEY } from '../decorators';
import { AppException } from '../exceptions/app.exception';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/**
 * Applied globally. Routes must opt out with `@Public()`, so a new endpoint is
 * authenticated by default — forgetting the decorator fails closed.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest<TUser = AuthenticatedUser>(
    err: unknown,
    user: TUser | false,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (err || !user) {
      throw AppException.unauthorized();
    }

    const authUser = user as unknown as AuthenticatedUser;

    // A user under a forced password change gets a valid token but almost no
    // reachable surface — only the routes that let them resolve the situation.
    if (authUser.mustChangePassword) {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed) {
        throw AppException.forbidden('auth.mustChangePassword');
      }
    }

    return user as TUser;
  }
}
