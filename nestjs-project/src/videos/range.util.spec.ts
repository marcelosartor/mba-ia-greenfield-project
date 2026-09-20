import { parseRange } from './range.util';

const TOTAL = 1000;

describe('parseRange', () => {
  it.each([undefined, ''])('should ignore a missing header (%p)', (header) => {
    expect(parseRange(header, TOTAL)).toEqual({ kind: 'none' });
  });

  describe('satisfiable ranges', () => {
    it.each([
      [
        'bytes=0-1023 past the end is limited to the file',
        'bytes=0-1023',
        0,
        999,
      ],
      ['a closed range', 'bytes=100-199', 100, 199],
      ['a single byte', 'bytes=5-5', 5, 5],
      ['an open range', 'bytes=500-', 500, 999],
      ['the whole file', 'bytes=0-', 0, 999],
      ['a suffix', 'bytes=-100', 900, 999],
      ['a suffix longer than the file', 'bytes=-5000', 0, 999],
      ['the last byte', 'bytes=999-999', 999, 999],
      ['spaces around the numbers', 'bytes= 10 - 20 ', 10, 20],
      ['an upper-case unit', 'BYTES=10-20', 10, 20],
    ])('should accept %s', (_label, header, start, end) => {
      expect(parseRange(header, TOTAL)).toEqual({
        kind: 'partial',
        start,
        end,
      });
    });
  });

  describe('unsatisfiable ranges', () => {
    it.each([
      ['a start past the end', 'bytes=9999999-10000000'],
      ['a start exactly at the size', 'bytes=1000-'],
      ['a start at the size with an end', 'bytes=1000-1500'],
      ['an empty suffix', 'bytes=-0'],
    ])('should report %s', (_label, header) => {
      expect(parseRange(header, TOTAL)).toEqual({ kind: 'unsatisfiable' });
    });

    it('should report any range over an empty file', () => {
      expect(parseRange('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' });
      expect(parseRange('bytes=-10', 0)).toEqual({ kind: 'unsatisfiable' });
    });
  });

  describe('headers that are ignored', () => {
    it.each([
      ['several ranges', 'bytes=0-10,20-30'],
      ['another unit', 'items=0-10'],
      ['no unit', '0-10'],
      ['a start after the end', 'bytes=20-10'],
      ['no numbers', 'bytes=-'],
      ['garbage', 'bytes=abc-def'],
      ['a negative start', 'bytes=--5'],
    ])('should ignore %s and serve the whole file', (_label, header) => {
      expect(parseRange(header, TOTAL)).toEqual({ kind: 'none' });
    });
  });
});
