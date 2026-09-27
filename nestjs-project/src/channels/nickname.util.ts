import { randomBytes } from 'crypto';

// Max nickname base length reserves 4 chars for the '_xxx' suffix (total column limit: 50)
const MAX_BASE_LENGTH = 46;

/** Format of a nickname chosen by the owner (Phase 04, TD-08). */
export const NICKNAME_PATTERN = /^[a-z0-9_]{3,50}$/;

export const MIN_NICKNAME_LENGTH = 3;

/**
 * Words that would clash with routes or read as official; refused on edit and
 * avoided when the nickname is generated at sign-up.
 */
export const RESERVED_NICKNAMES: ReadonlySet<string> = new Set([
  'me',
  'admin',
  'api',
  'channels',
  'videos',
  'categories',
  'auth',
  'docs',
  'support',
]);

export function isReservedNickname(nickname: string): boolean {
  return RESERVED_NICKNAMES.has(nickname);
}

function randomHex(length: number): string {
  return randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
}

export function sanitizeNickname(emailPrefix: string): string {
  const sanitized = emailPrefix
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, MAX_BASE_LENGTH);
  if (!sanitized) {
    return 'user_' + randomHex(8);
  }
  // A reserved word or a prefix too short for the edit rules gets the random
  // suffix, so every generated nickname is valid under NICKNAME_PATTERN.
  if (sanitized.length < MIN_NICKNAME_LENGTH || isReservedNickname(sanitized)) {
    return appendRandomSuffix(sanitized);
  }
  return sanitized;
}

export function appendRandomSuffix(nickname: string): string {
  const base = nickname.slice(0, MAX_BASE_LENGTH);
  return base + '_' + randomHex(3);
}
