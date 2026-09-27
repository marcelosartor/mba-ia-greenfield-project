import { SetMetadata } from '@nestjs/common';

export const THROTTLE_CLASS_KEY = 'throttleClass';

/** Named throttlers other than `default`; each counts only on its own routes. */
export const THROTTLE_CLASSES = [
  'public-read',
  'authenticated',
  'uploads',
] as const;
export type ThrottleClass = (typeof THROTTLE_CLASSES)[number];

/** Public read routes: `public-read`, counted per IP. */
export const PublicReadThrottle = () =>
  SetMetadata(THROTTLE_CLASS_KEY, 'public-read' satisfies ThrottleClass);

/** Ordinary authenticated reads and writes: `authenticated`, per user. */
export const AuthenticatedThrottle = () =>
  SetMetadata(THROTTLE_CLASS_KEY, 'authenticated' satisfies ThrottleClass);

/** Uploads (video parts, custom thumbnail): `uploads`, per user. */
export const UploadsThrottle = () =>
  SetMetadata(THROTTLE_CLASS_KEY, 'uploads' satisfies ThrottleClass);
