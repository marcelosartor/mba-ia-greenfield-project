import { randomBytes } from 'node:crypto';

export const PUBLIC_ID_LENGTH = 11;

// 64 URL-safe characters: a byte masked with 63 maps onto it without bias.
const PUBLIC_ID_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

export function generatePublicId(): string {
  const bytes = randomBytes(PUBLIC_ID_LENGTH);
  let publicId = '';
  for (const byte of bytes) {
    publicId += PUBLIC_ID_ALPHABET[byte & 63];
  }
  return publicId;
}
