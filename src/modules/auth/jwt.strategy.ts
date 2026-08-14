import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppException } from 'src/common/exceptions/app.exception';
import type {
  AccessTokenPayload,
  AuthenticatedUser,
} from 'src/common/interfaces/authenticated-user.interface';
import { AppConfig } from 'src/config/configuration';
import { AuthService } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  /**
   * Runs on every authenticated request.
   *
   * The user is re-read from the database rather than trusted from the token so
   * that a suspension, deletion, or role change takes effect immediately instead
   * of lingering until the access token expires.
   */
  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    // A refresh token is a valid JWT too — reject it here so it can never be
    // used as a bearer credential.
    if (payload.typ !== 'access') {
      throw AppException.unauthorized();
    }

    const user = await this.authService.findActiveUserById(payload.sub);
    if (!user) throw AppException.unauthorized();

    return this.authService.buildAuthUser(user);
  }
}
