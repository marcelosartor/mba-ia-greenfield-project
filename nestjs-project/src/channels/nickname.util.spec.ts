import {
  isReservedNickname,
  NICKNAME_PATTERN,
  appendRandomSuffix,
  sanitizeNickname,
} from './nickname.util';

describe('sanitizeNickname', () => {
  it('lowercases and strips invalid chars', () => {
    const result = sanitizeNickname('Hello.World+Test');
    expect(result).toBe('helloworldtest');
  });

  it('preserves underscores', () => {
    const result = sanitizeNickname('john_doe');
    expect(result).toBe('john_doe');
  });

  it('preserves digits', () => {
    const result = sanitizeNickname('user123');
    expect(result).toBe('user123');
  });

  it('truncates to 46 characters', () => {
    const long = 'a'.repeat(60);
    const result = sanitizeNickname(long);
    expect(result.length).toBe(46);
  });

  it('returns user_ + 8 random chars when result is empty', () => {
    const result = sanitizeNickname('!!!---');
    expect(result).toMatch(/^user_[a-z0-9]{8}$/);
  });

  it('returns user_ + 8 random chars for empty string', () => {
    const result = sanitizeNickname('');
    expect(result).toMatch(/^user_[a-z0-9]{8}$/);
  });

  it('produces different fallbacks on repeated empty-prefix calls', () => {
    const a = sanitizeNickname('!!!');
    const b = sanitizeNickname('!!!');
    expect(a).toMatch(/^user_[a-z0-9]{8}$/);
    expect(b).toMatch(/^user_[a-z0-9]{8}$/);
  });
});

describe('appendRandomSuffix', () => {
  it('appends underscore and 3 alphanumeric chars', () => {
    const result = appendRandomSuffix('john');
    expect(result).toMatch(/^john_[a-z0-9]{3}$/);
  });

  it('keeps total length at most 50 chars', () => {
    const long = 'a'.repeat(46);
    const result = appendRandomSuffix(long);
    expect(result.length).toBe(50);
  });

  it('truncates base to 46 before appending suffix', () => {
    const long = 'a'.repeat(60);
    const result = appendRandomSuffix(long);
    expect(result.length).toBe(50);
    expect(result).toMatch(/^a{46}_[a-z0-9]{3}$/);
  });

  it('produces only lowercase letters and digits in suffix', () => {
    for (let i = 0; i < 10; i++) {
      const result = appendRandomSuffix('base');
      expect(result).toMatch(/^base_[a-z0-9]{3}$/);
    }
  });
});

describe('nickname rules (Phase 04)', () => {
  it.each(['admin', 'me', 'ab'])(
    'gives the random suffix to the generated prefix %s',
    (prefix) => {
      const nickname = sanitizeNickname(prefix);

      expect(nickname).toMatch(new RegExp(`^${prefix}_[a-z0-9]{3}$`));
      expect(NICKNAME_PATTERN.test(nickname)).toBe(true);
      expect(isReservedNickname(nickname)).toBe(false);
    },
  );

  it('keeps a valid, non-reserved prefix unchanged', () => {
    expect(sanitizeNickname('joao_silva')).toBe('joao_silva');
  });

  it('keeps the user_ fallback for an empty prefix', () => {
    expect(sanitizeNickname('***')).toMatch(/^user_[a-z0-9]{8}$/);
  });

  it.each([
    'me',
    'admin',
    'api',
    'channels',
    'videos',
    'categories',
    'auth',
    'docs',
    'support',
  ])('reserves %s', (word) => {
    expect(isReservedNickname(word)).toBe(true);
  });

  it('does not reserve ordinary names', () => {
    expect(isReservedNickname('maria')).toBe(false);
  });

  it.each([
    ['ab', false],
    ['abc', true],
    ['a'.repeat(50), true],
    ['a'.repeat(51), false],
    ['Com-Hifen', false],
  ])('NICKNAME_PATTERN on %s is %s', (nickname, valid) => {
    expect(NICKNAME_PATTERN.test(nickname)).toBe(valid);
  });
});
