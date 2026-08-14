import { PermissionAction, PermissionResource, PersonType } from '../constants/enums';

/** One row of the resolved permission matrix attached to the request. */
export interface ResolvedPermission {
  resource: PermissionResource;
  actions: PermissionAction[];
}

/**
 * What `request.user` holds after JwtAuthGuard runs.
 *
 * Permissions are resolved from the role at authentication time (cached in
 * Redis) rather than embedded in the JWT: a revoked permission then takes effect
 * on the next request instead of when the access token happens to expire.
 */
export interface AuthenticatedUser {
  /** User id. Named `sub` to match the JWT claim it comes from. */
  sub: string;
  username: string;
  roleId: string;
  roleCode: string;
  personType: PersonType;
  personId: string | null;
  permissions: ResolvedPermission[];
  mustChangePassword: boolean;
  locale: string;
}

/** Claims actually encoded in the access token. */
export interface AccessTokenPayload {
  sub: string;
  username: string;
  roleId: string;
  personType: PersonType;
  personId: string | null;
  /** Token type, so a refresh token can never be presented as an access token. */
  typ: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  /** Random per-token id; its hash is what gets stored on the user. */
  jti: string;
  typ: 'refresh';
}
