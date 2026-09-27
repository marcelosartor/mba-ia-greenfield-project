import { SetMetadata } from '@nestjs/common';

export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';

/**
 * The route is readable without a token, but a valid `Authorization: Bearer`
 * token identifies the caller. A missing, malformed, invalid or expired token
 * is treated as anonymous instead of answering 401.
 */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);
