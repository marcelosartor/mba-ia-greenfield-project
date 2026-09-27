import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerOptions } from '@nestjs/throttler';
import {
  AuthenticatedThrottle,
  PublicReadThrottle,
  UploadsThrottle,
} from './throttle-class.decorator';
import {
  AUTHENTICATED_LIMIT,
  buildThrottlerOptions,
  DEFAULT_LIMIT,
  UPLOADS_LIMIT,
  userTracker,
} from './throttling.options';

class Routes {
  @PublicReadThrottle()
  publicRead(): void {}

  @AuthenticatedThrottle()
  authenticated(): void {}

  @UploadsThrottle()
  uploads(): void {}

  unclassified(): void {}
}

@AuthenticatedThrottle()
class ClassifiedController {
  handler(): void {}
}

const contextFor = (
  handler: keyof Routes | 'handler',
  classRef: object = Routes,
): ExecutionContext =>
  ({
    getHandler: () =>
      (classRef as { prototype: Record<string, unknown> }).prototype[handler],
    getClass: () => classRef,
  }) as unknown as ExecutionContext;

const throttlers = (): ThrottlerOptions[] => {
  const options = buildThrottlerOptions(300);
  if (Array.isArray(options)) throw new Error('expected named throttlers');
  return options.throttlers;
};

const counted = (context: ExecutionContext): string[] =>
  throttlers()
    .filter((throttler) => !throttler.skipIf?.(context))
    .map((throttler) => throttler.name!);

describe('buildThrottlerOptions', () => {
  it('registers the four named throttlers with their limits per minute', () => {
    expect(
      throttlers().map(({ name, limit, ttl }) => ({ name, limit, ttl })),
    ).toEqual([
      { name: 'default', limit: DEFAULT_LIMIT, ttl: 60000 },
      { name: 'public-read', limit: 300, ttl: 60000 },
      { name: 'authenticated', limit: AUTHENTICATED_LIMIT, ttl: 60000 },
      { name: 'uploads', limit: UPLOADS_LIMIT, ttl: 60000 },
    ]);
  });

  it('uses the configured public read limit', () => {
    const options = buildThrottlerOptions(5);
    const publicRead = Array.isArray(options)
      ? undefined
      : options.throttlers.find((t) => t.name === 'public-read');
    expect(publicRead?.limit).toBe(5);
  });

  it.each([
    ['publicRead', ['public-read']],
    ['authenticated', ['authenticated']],
    ['uploads', ['uploads']],
    ['unclassified', ['default']],
  ] as const)('counts a %s route only on %j', (handler, expected) => {
    expect(counted(contextFor(handler))).toEqual(expected);
  });

  it('reads the throttle class from the controller too', () => {
    expect(counted(contextFor('handler', ClassifiedController))).toEqual([
      'authenticated',
    ]);
  });

  it('tracks authenticated and uploads per user, the others per IP', () => {
    const trackerOf = (name: string): ThrottlerOptions['getTracker'] =>
      throttlers().find((t) => t.name === name)?.getTracker;
    expect(trackerOf('authenticated')).toBe(userTracker);
    expect(trackerOf('uploads')).toBe(userTracker);
    expect(trackerOf('default')).toBeUndefined();
    expect(trackerOf('public-read')).toBeUndefined();
  });
});

describe('userTracker', () => {
  it('keys on the JWT sub when the request is authenticated', () => {
    expect(userTracker({ user: { sub: 'u-1' }, ip: '10.0.0.1' })).toBe(
      'user:u-1',
    );
  });

  it('falls back to the IP when there is no user', () => {
    expect(userTracker({ ip: '10.0.0.1' })).toBe('ip:10.0.0.1');
  });
});
