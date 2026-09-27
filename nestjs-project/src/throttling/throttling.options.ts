import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type {
  ThrottlerModuleOptions,
  ThrottlerOptions,
} from '@nestjs/throttler';
import {
  THROTTLE_CLASS_KEY,
  type ThrottleClass,
} from './throttle-class.decorator';

const ONE_MINUTE_MS = 60_000;

export const DEFAULT_LIMIT = 10;
export const AUTHENTICATED_LIMIT = 120;
export const UPLOADS_LIMIT = 20;

const reflector = new Reflector();

export function throttleClassOf(
  context: ExecutionContext,
): ThrottleClass | undefined {
  return reflector.getAllAndOverride<ThrottleClass | undefined>(
    THROTTLE_CLASS_KEY,
    [context.getHandler(), context.getClass()],
  );
}

/** The JWT `sub` (set by JwtAuthGuard, which runs first), else the IP. */
export function userTracker(req: Record<string, any>): string {
  const sub = (req.user as { sub?: string } | undefined)?.sub;
  return sub ? `user:${sub}` : `ip:${req.ip as string}`;
}

/**
 * Four named throttlers. `default` (10/min per IP) counts only on routes
 * with no throttle class, so a route that was not classified stays on the
 * strictest limit; each of the others counts only on routes of its class.
 */
export function buildThrottlerOptions(
  publicReadLimit: number,
): ThrottlerModuleOptions {
  const classThrottler = (
    name: ThrottleClass,
    limit: number,
    extra: Partial<ThrottlerOptions> = {},
  ): ThrottlerOptions => ({
    name,
    ttl: ONE_MINUTE_MS,
    limit,
    skipIf: (context) => throttleClassOf(context) !== name,
    ...extra,
  });

  return {
    throttlers: [
      {
        name: 'default',
        ttl: ONE_MINUTE_MS,
        limit: DEFAULT_LIMIT,
        skipIf: (context) => throttleClassOf(context) !== undefined,
      },
      classThrottler('public-read', publicReadLimit),
      classThrottler('authenticated', AUTHENTICATED_LIMIT, {
        getTracker: userTracker,
      }),
      classThrottler('uploads', UPLOADS_LIMIT, { getTracker: userTracker }),
    ],
  };
}
