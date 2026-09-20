import { generatePublicId, PUBLIC_ID_LENGTH } from './public-id.util';

describe('generatePublicId', () => {
  it('should generate an identifier with 11 characters', () => {
    expect(generatePublicId()).toHaveLength(PUBLIC_ID_LENGTH);
    expect(PUBLIC_ID_LENGTH).toBe(11);
  });

  it('should only use URL-safe characters', () => {
    for (let i = 0; i < 500; i++) {
      expect(generatePublicId()).toMatch(/^[A-Za-z0-9_-]{11}$/);
    }
  });

  it('should not repeat across a large sample', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => generatePublicId()));

    expect(ids.size).toBe(5000);
  });
});
