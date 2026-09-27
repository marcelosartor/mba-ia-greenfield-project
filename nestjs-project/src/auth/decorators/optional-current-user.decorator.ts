import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../auth.types';

/** The caller on an `@OptionalAuth()` route, or `undefined` when anonymous. */
export const OptionalCurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload | undefined => {
    const request = ctx.switchToHttp().getRequest<{ user?: JwtPayload }>();
    return request.user;
  },
);
