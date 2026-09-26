import { expectedPartLength, partCountFor } from './upload-parts.util';

const PART = 64 * 1024 * 1024;

describe('partCountFor', () => {
  it.each([
    [1, 1],
    [PART, 1],
    [PART + 1, 2],
    [2 * PART + 1000, 3],
    [10 * 1024 ** 3, 160],
  ])('should split %d bytes into %d parts', (size, count) => {
    expect(partCountFor(size, PART)).toBe(count);
  });
});

describe('expectedPartLength', () => {
  it('should give every part but the last the part size and the last the rest', () => {
    const size = 2 * PART + 1000;

    expect([1, 2, 3].map((n) => expectedPartLength(size, PART, n))).toEqual([
      PART,
      PART,
      1000,
    ]);
  });

  it('should make the parts add up to the declared size', () => {
    for (const size of [1, PART - 1, PART, PART + 1, 7 * PART + 12345]) {
      const count = partCountFor(size, PART);
      const total = Array.from({ length: count }, (_, i) =>
        expectedPartLength(size, PART, i + 1),
      ).reduce((sum, length) => sum + length, 0);

      expect(total).toBe(size);
    }
  });

  it('should treat a size that is a multiple of the part size as full parts', () => {
    expect(expectedPartLength(2 * PART, PART, 2)).toBe(PART);
  });
});
