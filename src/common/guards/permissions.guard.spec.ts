import { ExecutionContext, ForbiddenException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequiredPermission } from '../decorators';
import { AppException } from '../exceptions/app.exception';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { PermissionsGuard } from './permissions.guard';

const buildUser = (permissions: AuthenticatedUser['permissions']): AuthenticatedUser => ({
  sub: '507f1f77bcf86cd799439011',
  username: 'tester',
  roleId: '507f1f77bcf86cd799439012',
  roleCode: 'teacher',
  personType: 'teacher',
  personId: '507f1f77bcf86cd799439013',
  permissions,
  mustChangePassword: false,
  locale: 'lo',
});

const buildContext = (user?: AuthenticatedUser): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  }) as unknown as ExecutionContext;

describe('PermissionsGuard', () => {
  let reflector: Reflector;
  let guard: PermissionsGuard;

  const withRequired = (required: RequiredPermission[] | undefined) => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(required);
  };

  beforeEach(() => {
    reflector = new Reflector();
    guard = new PermissionsGuard(reflector);
  });

  it('allows a route that declares no permissions', () => {
    withRequired(undefined);
    expect(guard.canActivate(buildContext(buildUser([])))).toBe(true);
  });

  it('allows a route that declares an empty permission list', () => {
    withRequired([]);
    expect(guard.canActivate(buildContext(buildUser([])))).toBe(true);
  });

  it('allows the exact action on the resource', () => {
    withRequired([{ resource: 'scores', action: 'create' }]);
    const user = buildUser([{ resource: 'scores', actions: ['create', 'read'] }]);
    expect(guard.canActivate(buildContext(user))).toBe(true);
  });

  it('denies an action the role does not hold', () => {
    withRequired([{ resource: 'scores', action: 'update' }]);
    const user = buildUser([{ resource: 'scores', actions: ['read'] }]);
    expect(() => guard.canActivate(buildContext(user))).toThrow(AppException);
  });

  it('denies a resource the role has no grant for', () => {
    withRequired([{ resource: 'students', action: 'read' }]);
    const user = buildUser([{ resource: 'scores', actions: ['manage'] }]);
    expect(() => guard.canActivate(buildContext(user))).toThrow(AppException);
  });

  it('treats `manage` as implying every action on that resource', () => {
    const user = buildUser([{ resource: 'students', actions: ['manage'] }]);

    for (const action of ['create', 'read', 'update', 'delete', 'approve', 'export'] as const) {
      withRequired([{ resource: 'students', action }]);
      expect(guard.canActivate(buildContext(user))).toBe(true);
    }
  });

  it('does not let `manage` on one resource leak to another', () => {
    withRequired([{ resource: 'roles', action: 'read' }]);
    const user = buildUser([{ resource: 'students', actions: ['manage'] }]);
    expect(() => guard.canActivate(buildContext(user))).toThrow(AppException);
  });

  it('requires every declared permission, not just one', () => {
    withRequired([
      { resource: 'scores', action: 'read' },
      { resource: 'enrollments', action: 'read' },
    ]);
    const user = buildUser([{ resource: 'scores', actions: ['read'] }]);
    expect(() => guard.canActivate(buildContext(user))).toThrow(AppException);
  });

  it('passes when every declared permission is held', () => {
    withRequired([
      { resource: 'scores', action: 'read' },
      { resource: 'enrollments', action: 'read' },
    ]);
    const user = buildUser([
      { resource: 'scores', actions: ['read'] },
      { resource: 'enrollments', actions: ['read'] },
    ]);
    expect(guard.canActivate(buildContext(user))).toBe(true);
  });

  it('rejects an unauthenticated request with 401, not 403', () => {
    withRequired([{ resource: 'scores', action: 'read' }]);
    try {
      guard.canActivate(buildContext(undefined));
      fail('expected the guard to throw');
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    }
  });

  it('names the missing permissions in the error detail', () => {
    withRequired([{ resource: 'scores', action: 'update' }]);
    const user = buildUser([{ resource: 'scores', actions: ['read'] }]);

    try {
      guard.canActivate(buildContext(user));
      fail('expected the guard to throw');
    } catch (error) {
      const appError = error as AppException;
      expect(appError.getStatus()).toBe(HttpStatus.FORBIDDEN);
      expect(appError.details).toEqual({ required: ['scores:update'] });
    }
  });

  it('does not throw a bare ForbiddenException, so the message stays translatable', () => {
    withRequired([{ resource: 'scores', action: 'update' }]);
    const user = buildUser([]);
    expect(() => guard.canActivate(buildContext(user))).not.toThrow(ForbiddenException);
  });
});
