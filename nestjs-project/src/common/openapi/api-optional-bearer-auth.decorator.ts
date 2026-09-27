import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';

/**
 * OpenAPI for an `@OptionalAuth()` route: the operation accepts no token or
 * the `access-token` bearer, so its `security` lists an empty requirement
 * besides the bearer one.
 */
export const ApiOptionalBearerAuth = () =>
  applyDecorators(ApiSecurity({}), ApiBearerAuth('access-token'));
