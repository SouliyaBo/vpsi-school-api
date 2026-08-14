import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { AppException } from 'src/common/exceptions/app.exception';
import type {
  AccessTokenPayload,
  AuthenticatedUser,
  RefreshTokenPayload,
} from 'src/common/interfaces/authenticated-user.interface';
import { AppConfig } from 'src/config/configuration';
import { MAX_ACTIVE_SESSIONS, Role, RoleDocument, User, UserDocument } from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthTokensDto, LoginResponseDto } from './dto/auth.dto';

export interface RequestContext {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * argon2id parameters.
 *
 * 19 MiB / 2 iterations / 1 lane is the OWASP-recommended minimum configuration
 * for argon2id and takes roughly 50 ms on typical server hardware — slow enough
 * to make offline cracking expensive, fast enough not to be a login DoS vector.
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * A precomputed hash used to equalize timing on unknown usernames.
 *
 * Without this, "no such user" returns measurably faster than "wrong password",
 * which lets an attacker enumerate valid usernames.
 */
let DUMMY_HASH: string | null = null;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly audit: AuditLogsService,
  ) {}

  // ── Login ─────────────────────────────────────────────────────────────────

  async login(
    username: string,
    password: string,
    context: RequestContext,
  ): Promise<LoginResponseDto> {
    const user = await this.userModel
      .findOne({ username, deletedAt: null })
      .select('+passwordHash')
      .exec();

    if (!user) {
      // Burn the same time a real verification would, then fail identically.
      await this.verifyAgainstDummy(password);
      await this.audit.record({
        action: 'login_failed',
        entityType: 'users',
        username,
        ip: context.ip,
        userAgent: context.userAgent,
        reason: 'unknown username',
      });
      throw AppException.unauthorized('auth.invalidCredentials');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw AppException.unauthorized('auth.accountLocked', {
        lockedUntil: user.lockedUntil.toISOString(),
      });
    }

    const passwordValid = await argon2.verify(user.passwordHash, password);
    if (!passwordValid) {
      await this.registerFailedAttempt(user, context);
      throw AppException.unauthorized('auth.invalidCredentials');
    }

    // Status is checked only after the password verifies, so a disabled account
    // is indistinguishable from a wrong password to someone guessing.
    if (user.status !== 'active') {
      throw AppException.unauthorized('auth.accountInactive');
    }

    const tokens = await this.issueTokens(user, context, { resetFailures: true });
    const authUser = await this.buildAuthUser(user);

    await this.audit.record({
      action: 'login',
      entityType: 'users',
      entityId: user._id,
      userId: user._id,
      username: user.username,
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return {
      tokens,
      user: {
        id: user._id.toString(),
        username: user.username,
        roleCode: authUser.roleCode,
        personType: user.personType,
        personId: user.personId?.toString() ?? null,
        mustChangePassword: user.mustChangePassword,
        locale: user.locale,
        permissions: authUser.permissions,
      },
    };
  }

  /**
   * Rotates a refresh token.
   *
   * The presented token must match a stored hash. If it validates as a JWT but
   * its hash is absent, it was already rotated away — that means someone is
   * replaying a stolen token, so every session for the user is revoked.
   */
  async refresh(refreshToken: string, context: RequestContext): Promise<AuthTokensDto> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      });
    } catch {
      throw AppException.unauthorized('auth.invalidRefreshToken');
    }

    if (payload.typ !== 'refresh') {
      throw AppException.unauthorized('auth.invalidRefreshToken');
    }

    const user = await this.userModel
      .findOne({ _id: payload.sub, deletedAt: null })
      .select('+refreshTokens')
      .exec();

    if (!user || user.status !== 'active') {
      throw AppException.unauthorized('auth.invalidRefreshToken');
    }

    const presentedHash = hashToken(refreshToken);
    const stored = user.refreshTokens.find((entry) => safeEquals(entry.tokenHash, presentedHash));

    if (!stored) {
      user.refreshTokens = [];
      await user.save();
      await this.audit.record({
        action: 'logout',
        entityType: 'users',
        entityId: user._id,
        userId: user._id,
        username: user.username,
        ip: context.ip,
        reason: 'refresh token reuse detected — all sessions revoked',
      });
      this.logger.warn(`Refresh token reuse detected for user ${user.username}`);
      throw AppException.unauthorized('auth.tokenReuseDetected');
    }

    if (stored.expiresAt < new Date()) {
      user.refreshTokens = user.refreshTokens.filter((e) => e.tokenHash !== presentedHash);
      await user.save();
      throw AppException.unauthorized('auth.invalidRefreshToken');
    }

    return this.issueTokens(user, context, { replaceTokenHash: presentedHash });
  }

  /** Revokes one session, or all of them when `allDevices` is set. */
  async logout(userId: string, refreshToken?: string, allDevices = false): Promise<void> {
    const user = await this.userModel.findById(userId).select('+refreshTokens').exec();
    if (!user) return;

    if (allDevices || !refreshToken) {
      user.refreshTokens = [];
    } else {
      const hash = hashToken(refreshToken);
      user.refreshTokens = user.refreshTokens.filter((e) => !safeEquals(e.tokenHash, hash));
    }

    await user.save();
    await this.audit.record({
      action: 'logout',
      entityType: 'users',
      entityId: user._id,
      userId: user._id,
      username: user.username,
    });
  }

  // ── Password management ───────────────────────────────────────────────────

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    context: RequestContext,
  ): Promise<void> {
    const user = await this.userModel.findById(userId).select('+passwordHash').exec();
    if (!user) throw AppException.notFound();

    const valid = await argon2.verify(user.passwordHash, currentPassword);
    if (!valid) throw AppException.badRequest('auth.currentPasswordIncorrect');

    user.passwordHash = await argon2.hash(newPassword, ARGON2_OPTIONS);
    user.passwordChangedAt = new Date();
    user.mustChangePassword = false;
    // Changing a password invalidates every existing session, everywhere.
    user.refreshTokens = [];
    await user.save();

    await this.audit.record({
      action: 'password_change',
      entityType: 'users',
      entityId: user._id,
      userId: user._id,
      username: user.username,
      ip: context.ip,
    });
  }

  /**
   * Starts a reset and returns the raw token.
   *
   * The token is returned to the caller rather than emailed because no mail
   * transport is in scope for this phase; an admin hands it over out of band.
   * Only its hash is stored, so the database never holds a usable token.
   */
  async requestPasswordReset(username: string): Promise<{ token: string | null }> {
    const user = await this.userModel.findOne({ username, deletedAt: null }).exec();
    // Always report success: revealing that a username has no account is an
    // enumeration oracle.
    if (!user || user.status !== 'active') return { token: null };

    const token = randomBytes(32).toString('hex');
    user.passwordResetTokenHash = hashToken(token);
    user.passwordResetExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await user.save();

    await this.audit.record({
      action: 'password_reset',
      entityType: 'users',
      entityId: user._id,
      userId: user._id,
      username: user.username,
      reason: 'reset requested',
    });

    return { token };
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenHash = hashToken(token);
    const user = await this.userModel
      .findOne({
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: { $gt: new Date() },
        deletedAt: null,
      })
      .select('+passwordHash +passwordResetTokenHash +passwordResetExpiresAt')
      .exec();

    if (!user) throw AppException.badRequest('auth.invalidRefreshToken');

    user.passwordHash = await argon2.hash(newPassword, ARGON2_OPTIONS);
    user.passwordResetTokenHash = null;
    user.passwordResetExpiresAt = null;
    user.passwordChangedAt = new Date();
    user.mustChangePassword = false;
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.refreshTokens = [];
    await user.save();

    await this.audit.record({
      action: 'password_reset',
      entityType: 'users',
      entityId: user._id,
      userId: user._id,
      username: user.username,
      reason: 'reset completed',
    });
  }

  // ── Helpers used by the JWT strategy ──────────────────────────────────────

  /**
   * Loads the user and resolves the role's permission matrix.
   *
   * Called on every authenticated request. Permissions live here rather than in
   * the token so a permission change applies on the next request rather than
   * after the access token expires.
   */
  async buildAuthUser(user: UserDocument): Promise<AuthenticatedUser> {
    const role = await this.roleModel.findById(user.roleId).lean().exec();

    return {
      sub: user._id.toString(),
      username: user.username,
      roleId: user.roleId.toString(),
      roleCode: role?.code ?? 'unknown',
      personType: user.personType,
      personId: user.personId?.toString() ?? null,
      permissions: (role?.permissions ?? []).map((p) => ({
        resource: p.resource,
        actions: p.actions,
      })),
      mustChangePassword: user.mustChangePassword,
      locale: user.locale,
    };
  }

  async findActiveUserById(id: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.userModel.findOne({ _id: id, status: 'active', deletedAt: null }).exec();
  }

  static hashPassword(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async issueTokens(
    user: UserDocument,
    context: RequestContext,
    options: { resetFailures?: boolean; replaceTokenHash?: string } = {},
  ): Promise<AuthTokensDto> {
    const accessPayload: AccessTokenPayload = {
      sub: user._id.toString(),
      username: user.username,
      roleId: user.roleId.toString(),
      personType: user.personType,
      personId: user.personId?.toString() ?? null,
      typ: 'access',
    };

    const refreshPayload: RefreshTokenPayload = {
      sub: user._id.toString(),
      jti: randomUUID(),
      typ: 'refresh',
    };

    const accessTtl = this.config.get('JWT_ACCESS_TTL', { infer: true });
    const refreshTtl = this.config.get('JWT_REFRESH_TTL', { infer: true });

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: accessTtl,
      }),
      this.jwt.signAsync(refreshPayload, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
        expiresIn: refreshTtl,
      }),
    ]);

    // Reload with the session array selected — the caller's document may not have it.
    const fresh = await this.userModel.findById(user._id).select('+refreshTokens').exec();
    if (!fresh) throw AppException.unauthorized();

    let sessions = fresh.refreshTokens ?? [];
    if (options.replaceTokenHash) {
      sessions = sessions.filter((e) => !safeEquals(e.tokenHash, options.replaceTokenHash!));
    }
    // Drop anything already expired while we are here.
    const now = new Date();
    sessions = sessions.filter((e) => e.expiresAt > now);

    sessions.push({
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + parseDuration(refreshTtl)),
      createdAt: now,
      userAgent: context.userAgent ?? null,
      ip: context.ip ?? null,
    });

    // Oldest sessions fall off once the device limit is reached.
    if (sessions.length > MAX_ACTIVE_SESSIONS) {
      sessions = sessions
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(sessions.length - MAX_ACTIVE_SESSIONS);
    }

    fresh.refreshTokens = sessions;
    fresh.lastLoginAt = now;
    if (options.resetFailures) {
      fresh.failedLoginAttempts = 0;
      fresh.lockedUntil = null;
    }
    await fresh.save();

    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(parseDuration(accessTtl) / 1000),
      tokenType: 'Bearer',
    };
  }

  private async registerFailedAttempt(user: UserDocument, context: RequestContext): Promise<void> {
    const max = this.config.get('MAX_FAILED_LOGIN_ATTEMPTS', { infer: true });
    const lockMinutes = this.config.get('ACCOUNT_LOCK_MINUTES', { infer: true });

    user.failedLoginAttempts += 1;
    if (user.failedLoginAttempts >= max) {
      user.lockedUntil = new Date(Date.now() + lockMinutes * 60 * 1000);
      user.failedLoginAttempts = 0;
    }
    await user.save();

    await this.audit.record({
      action: 'login_failed',
      entityType: 'users',
      entityId: user._id,
      userId: user._id,
      username: user.username,
      ip: context.ip,
      userAgent: context.userAgent,
      reason: user.lockedUntil ? 'account locked' : 'wrong password',
    });
  }

  private async verifyAgainstDummy(password: string): Promise<void> {
    DUMMY_HASH ??= await argon2.hash('timing-equalization-placeholder', ARGON2_OPTIONS);
    try {
      await argon2.verify(DUMMY_HASH, password);
    } catch {
      // Expected to fail; the point is the elapsed time, not the result.
    }
  }
}

/** SHA-256 is right here: the input is already high-entropy, so a slow KDF adds nothing. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison of two hex digests. */
function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Parses `15m` / `7d` / `3600s` into milliseconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber * 1000;
    throw new Error(`Invalid duration: "${value}"`);
  }
  const amount = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return amount * multipliers[unit];
}
