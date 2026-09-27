import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { IS_OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

const TEST_SECRET = 'test-secret';

const STUB_HANDLER = jest.fn();
const STUB_CLASS = class {};

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => STUB_HANDLER,
    getClass: () => STUB_CLASS,
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtService: JwtService;
  let mockReflector: { getAllAndOverride: jest.Mock };

  beforeAll(async () => {
    mockReflector = { getAllAndOverride: jest.fn() };

    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: TEST_SECRET,
          signOptions: { expiresIn: '15m' },
        }),
      ],
      providers: [
        JwtAuthGuard,
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();

    guard = module.get(JwtAuthGuard);
    jwtService = module.get(JwtService);
  });

  beforeEach(() => {
    mockReflector.getAllAndOverride.mockReturnValue(false);
  });

  it('bypasses guard on @Public() routes', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(true);
    const ctx = makeContext({ headers: {} });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('passes with a valid JWT and attaches payload to request.user', async () => {
    const token = jwtService.sign({ sub: 'user-1', email: 'a@example.com' });
    const request: Record<string, unknown> = {
      headers: { authorization: `Bearer ${token}` },
    };
    const ctx = makeContext(request);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((request.user as Record<string, unknown>)?.sub).toBe('user-1');
    expect((request.user as Record<string, unknown>)?.email).toBe(
      'a@example.com',
    );
  });

  it('throws UnauthorizedException when Authorization header is missing', async () => {
    const ctx = makeContext({ headers: {} });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException on malformed Bearer token', async () => {
    const ctx = makeContext({
      headers: { authorization: 'Bearer not-a-valid-jwt' },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException on expired JWT', async () => {
    const expiredToken = jwtService.sign(
      { sub: 'user-1', email: 'a@example.com' },
      { expiresIn: -60 },
    );
    const ctx = makeContext({
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  describe('on @OptionalAuth() routes', () => {
    beforeEach(() => {
      mockReflector.getAllAndOverride.mockImplementation(
        (key: string) => key === IS_OPTIONAL_AUTH_KEY,
      );
    });

    it('attaches the payload of a valid token to request.user', async () => {
      const token = jwtService.sign({ sub: 'user-1', email: 'a@example.com' });
      const request: Record<string, unknown> = {
        headers: { authorization: `Bearer ${token}` },
      };

      await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
      expect((request.user as Record<string, unknown>)?.sub).toBe('user-1');
    });

    it.each([
      ['a missing header', {}],
      ['a malformed token', { authorization: 'Bearer abc' }],
      ['a header without the Bearer prefix', { authorization: 'Token abc' }],
    ])('lets %s through as anonymous', async (_label, headers) => {
      const request: Record<string, unknown> = { headers };

      await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
      expect(request.user).toBeUndefined();
    });

    it('lets a token with an invalid signature through as anonymous', async () => {
      const forged = new JwtService({ secret: 'another-secret' }).sign({
        sub: 'user-1',
        email: 'a@example.com',
      });
      const request: Record<string, unknown> = {
        headers: { authorization: `Bearer ${forged}` },
      };

      await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
      expect(request.user).toBeUndefined();
    });

    it('lets an expired token through as anonymous', async () => {
      const expired = jwtService.sign(
        { sub: 'user-1', email: 'a@example.com' },
        { expiresIn: -60 },
      );
      const request: Record<string, unknown> = {
        headers: { authorization: `Bearer ${expired}` },
      };

      await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
      expect(request.user).toBeUndefined();
    });

    it('ignores a token sent in the query string or in a cookie', async () => {
      const token = jwtService.sign({ sub: 'user-1', email: 'a@example.com' });
      const request: Record<string, unknown> = {
        headers: { cookie: `access_token=${token}` },
        query: { token },
      };

      await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
      expect(request.user).toBeUndefined();
    });
  });
});
