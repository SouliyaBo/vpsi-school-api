import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  TestContext,
  auth,
  createTestApp,
  login,
} from './test-app';

/**
 * Authentication and authorization.
 *
 * The seeded admin starts with `mustChangePassword` set, so the first act of
 * most tests is to clear it — which also exercises that flow.
 */
describe('Auth (e2e)', () => {
  let context: TestContext;
  let app: INestApplication;

  const NEW_ADMIN_PASSWORD = 'AdminPass456';

  /**
   * Wrong-password tests target this account rather than `admin`.
   *
   * Five failures lock an account, so aiming them at `admin` would lock it
   * mid-suite and cascade into unrelated failures. The tests below make exactly
   * five failed attempts, which is the limit — a sixth would need this account
   * unlocked first.
   */
  const VICTIM_USERNAME = 'wrongpass-target';

  beforeAll(async () => {
    context = await createTestApp();
    app = context.app;

    // Clear the seeded forced-password-change so the admin can create accounts.
    const initial = await login(app, ADMIN_USERNAME, ADMIN_PASSWORD);
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set(auth(initial.accessToken))
      .send({ currentPassword: ADMIN_PASSWORD, newPassword: NEW_ADMIN_PASSWORD })
      .expect(204);

    const admin = await login(app, ADMIN_USERNAME, NEW_ADMIN_PASSWORD);
    const roleId = (await context.seed.findRoleId('teacher'))!.toString();

    await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(admin.accessToken))
      .send({
        username: VICTIM_USERNAME,
        password: 'VictimPass123',
        roleId,
        personType: 'staff',
        mustChangePassword: false,
      })
      .expect(201);
  }, 120_000);

  afterAll(async () => {
    // Guarded: if beforeAll failed, `context` is undefined and an error here
    // would replace the real failure in the report.
    await context?.close();
  });

  describe('login', () => {
    it('issues an access/refresh pair for valid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: ADMIN_USERNAME, password: NEW_ADMIN_PASSWORD })
        .expect(200);

      expect(response.body.tokens.accessToken).toEqual(expect.any(String));
      expect(response.body.tokens.refreshToken).toEqual(expect.any(String));
      expect(response.body.tokens.tokenType).toBe('Bearer');
      expect(response.body.user.username).toBe('admin');
      expect(response.body.user.roleCode).toBe('admin');
    });

    it('never returns the password hash', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: ADMIN_USERNAME, password: NEW_ADMIN_PASSWORD })
        .expect(200);

      expect(JSON.stringify(response.body)).not.toContain('passwordHash');
      expect(JSON.stringify(response.body)).not.toContain('$argon2');
    });

    it('rejects a wrong password with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: VICTIM_USERNAME, password: 'WrongPassword1' })
        .expect(401);
    });

    it('gives the same response for an unknown username as for a wrong password', async () => {
      // Distinguishable responses would let an attacker enumerate valid accounts.
      const unknown = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'nobody', password: 'WrongPassword1' })
        .expect(401);

      const wrongPassword = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: VICTIM_USERNAME, password: 'WrongPassword1' })
        .expect(401);

      expect(unknown.body.messageKey).toBe(wrongPassword.body.messageKey);
    });

    it('returns Lao messages by default and English on request', async () => {
      const lao = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: VICTIM_USERNAME, password: 'WrongPassword1' })
        .expect(401);
      expect(lao.body.message).toContain('ບໍ່ຖືກຕ້ອງ');

      const english = await request(app.getHttpServer())
        .post('/api/auth/login?lang=en')
        .send({ username: VICTIM_USERNAME, password: 'WrongPassword1' })
        .expect(401);
      expect(english.body.message).toBe('Invalid username or password');
    });

    it('honours the Accept-Language header', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('Accept-Language', 'en-US,en;q=0.9')
        .send({ username: VICTIM_USERNAME, password: 'WrongPassword1' })
        .expect(401);

      expect(response.body.message).toBe('Invalid username or password');
    });

    it('rejects a request with unknown properties', async () => {
      // forbidNonWhitelisted — mass-assignment protection.
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: ADMIN_USERNAME, password: NEW_ADMIN_PASSWORD, roleId: 'injected' })
        .expect(400);
    });
  });

  describe('forced password change', () => {
    // A fresh account per test, since clearing the flag is what is being tested.
    const INITIAL = 'InitialPass123';
    let username: string;
    let token: string;

    beforeEach(async () => {
      const admin = await login(app, ADMIN_USERNAME, NEW_ADMIN_PASSWORD);
      const roleId = (await context.seed.findRoleId('teacher'))!.toString();
      username = `mustchange-${Date.now()}`;

      await request(app.getHttpServer())
        .post('/api/users')
        .set(auth(admin.accessToken))
        .send({
          username,
          password: INITIAL,
          roleId,
          personType: 'staff',
          // The default anyway; stated to make the test's premise explicit.
          mustChangePassword: true,
        })
        .expect(201);

      token = (await login(app, username, INITIAL)).accessToken;
    });

    it('blocks ordinary endpoints while mustChangePassword is set', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/students')
        .set(auth(token))
        .expect(403);

      expect(response.body.messageKey).toBe('auth.mustChangePassword');
    });

    it('still allows /auth/me', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set(auth(token))
        .expect(200);

      expect(response.body.mustChangePassword).toBe(true);
    });

    it('clears the flag once the password is changed', async () => {
      const changed = 'ChangedPass456';

      await request(app.getHttpServer())
        .post('/api/auth/change-password')
        .set(auth(token))
        .send({ currentPassword: INITIAL, newPassword: changed })
        .expect(204);

      const after = await login(app, username, changed);
      const me = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set(auth(after.accessToken))
        .expect(200);

      expect(me.body.mustChangePassword).toBe(false);

      // Ordinary endpoints are reachable now.
      await request(app.getHttpServer())
        .get('/api/students')
        .set(auth(after.accessToken))
        .expect(200);
    });

    it('rejects a change with the wrong current password', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/change-password')
        .set(auth(token))
        .send({ currentPassword: 'NotThePassword1', newPassword: 'Another123' })
        .expect(400);
    });

    it('enforces the password policy on the new password', async () => {
      // Too short, no uppercase, no lowercase, no digit — each rejected.
      for (const weak of ['Shrt1', 'alllowercase1', 'ALLUPPERCASE1', 'NoDigitsHere']) {
        await request(app.getHttpServer())
          .post('/api/auth/change-password')
          .set(auth(token))
          .send({ currentPassword: INITIAL, newPassword: weak })
          .expect(400);
      }
    });
  });

  describe('token handling', () => {
    it('requires a token on protected routes', async () => {
      await request(app.getHttpServer()).get('/api/students').expect(401);
    });

    it('rejects a malformed token', async () => {
      await request(app.getHttpServer())
        .get('/api/students')
        .set(auth('not-a-real-token'))
        .expect(401);
    });

    it('refuses a refresh token presented as a bearer credential', async () => {
      // Both are valid JWTs; only the access token may authenticate a request.
      const { refreshToken } = await login(app, ADMIN_USERNAME, NEW_ADMIN_PASSWORD);

      await request(app.getHttpServer()).get('/api/students').set(auth(refreshToken)).expect(401);
    });

    it('rotates the refresh token and invalidates the old one', async () => {
      const first = await login(app, ADMIN_USERNAME, NEW_ADMIN_PASSWORD);

      const rotated = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200);

      expect(rotated.body.refreshToken).not.toBe(first.refreshToken);

      // The new one works.
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: rotated.body.refreshToken })
        .expect(200);
    });

    it('revokes every session when a rotated token is replayed', async () => {
      const session = await login(app, ADMIN_USERNAME, NEW_ADMIN_PASSWORD);

      const rotated = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(200);

      // Replaying the superseded token signals theft.
      const replay = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);
      expect(replay.body.messageKey).toBe('auth.tokenReuseDetected');

      // …and the token issued in the meantime is dead too.
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: rotated.body.refreshToken })
        .expect(401);
    });

    it('invalidates all refresh tokens after a password change', async () => {
      const session = await login(app, ADMIN_USERNAME, NEW_ADMIN_PASSWORD);
      const interim = 'InterimPass789';

      await request(app.getHttpServer())
        .post('/api/auth/change-password')
        .set(auth(session.accessToken))
        .send({ currentPassword: NEW_ADMIN_PASSWORD, newPassword: interim })
        .expect(204);

      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);

      // Restore for any later test in this file.
      const restored = await login(app, ADMIN_USERNAME, interim);
      await request(app.getHttpServer())
        .post('/api/auth/change-password')
        .set(auth(restored.accessToken))
        .send({ currentPassword: interim, newPassword: NEW_ADMIN_PASSWORD })
        .expect(204);
    });

    it('revokes the current session on logout', async () => {
      const session = await login(app, ADMIN_USERNAME, NEW_ADMIN_PASSWORD);

      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set(auth(session.accessToken))
        .send({ refreshToken: session.refreshToken })
        .expect(204);

      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);
    });
  });

  describe('password reset', () => {
    it('returns 200 for an unknown username without revealing anything', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ username: 'definitely-not-a-user' })
        .expect(200);

      expect(response.body.token).toBeNull();
    });

    it('completes a reset with the issued token', async () => {
      const requested = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ username: ADMIN_USERNAME })
        .expect(200);

      expect(requested.body.token).toEqual(expect.any(String));
      const resetPassword = 'ResetPass321';

      await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token: requested.body.token, newPassword: resetPassword })
        .expect(204);

      const session = await login(app, ADMIN_USERNAME, resetPassword);
      expect(session.accessToken).toEqual(expect.any(String));

      // Restore the known password for other suites.
      await request(app.getHttpServer())
        .post('/api/auth/change-password')
        .set(auth(session.accessToken))
        .send({ currentPassword: resetPassword, newPassword: NEW_ADMIN_PASSWORD })
        .expect(204);
    });

    it('rejects a reset token that has already been used', async () => {
      const requested = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ username: ADMIN_USERNAME })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token: requested.body.token, newPassword: 'OnceOnly123' })
        .expect(204);

      await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token: requested.body.token, newPassword: 'TwiceNope123' })
        .expect(400);

      // Restore.
      const session = await login(app, ADMIN_USERNAME, 'OnceOnly123');
      await request(app.getHttpServer())
        .post('/api/auth/change-password')
        .set(auth(session.accessToken))
        .send({ currentPassword: 'OnceOnly123', newPassword: NEW_ADMIN_PASSWORD })
        .expect(204);
    });

    it('rejects a fabricated reset token', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token: 'a'.repeat(64), newPassword: 'Whatever123' })
        .expect(400);
    });
  });

  describe('brute-force protection', () => {
    it('locks an account after repeated failures and reports it distinctly', async () => {
      const { accessToken } = await login(app, ADMIN_USERNAME, NEW_ADMIN_PASSWORD);

      // A throwaway account, so the admin login stays usable.
      const roleId = (await context.seed.findRoleId('teacher'))!.toString();
      const created = await request(app.getHttpServer())
        .post('/api/users')
        .set(auth(accessToken))
        .send({
          username: 'locktest',
          password: 'InitialPass1',
          roleId,
          personType: 'staff',
          mustChangePassword: false,
        })
        .expect(201);

      expect(created.body.id).toEqual(expect.any(String));

      // MAX_FAILED_LOGIN_ATTEMPTS defaults to 5.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ username: 'locktest', password: 'WrongPass1' })
          .expect(401);
      }

      // Now even the correct password is refused, with a different reason.
      const locked = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'locktest', password: 'InitialPass1' })
        .expect(401);

      expect(locked.body.messageKey).toBe('auth.accountLocked');
    });
  });

  describe('health probes', () => {
    it('serves liveness without authentication', async () => {
      const response = await request(app.getHttpServer()).get('/health').expect(200);
      expect(response.body.status).toBe('ok');
    });

    it('reports the database as connected in readiness', async () => {
      const response = await request(app.getHttpServer()).get('/health/ready').expect(200);
      expect(response.body.database).toBe('connected');
    });
  });
});
