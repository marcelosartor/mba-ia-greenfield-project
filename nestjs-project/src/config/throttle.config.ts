import { registerAs } from '@nestjs/config';

export default registerAs('throttle', () => ({
  /** Requests per minute per IP on the public read routes (`public-read`). */
  publicReadLimit: parseInt(
    process.env.THROTTLE_PUBLIC_READ_LIMIT || '300',
    10,
  ),
}));
