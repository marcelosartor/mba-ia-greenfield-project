export type ParsedRange =
  | { kind: 'none' }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'unsatisfiable' };

// A single range: `start-end`, `start-` or `-suffix` (RFC 9110, section 14).
const SINGLE_BYTE_RANGE = /^bytes=\s*(\d*)\s*-\s*(\d*)\s*$/i;

/**
 * Reads a `Range` header for a file of `totalBytes`.
 * - `none`: no header, or one that is not a single byte range (several ranges,
 *   another unit, invalid syntax): it is ignored and the whole file is served.
 * - `partial`: a satisfiable range, with `end` already limited to the file.
 * - `unsatisfiable`: a well-formed range that starts past the end of the file.
 */
export function parseRange(
  header: string | undefined,
  totalBytes: number,
): ParsedRange {
  if (!header) {
    return { kind: 'none' };
  }
  const match = SINGLE_BYTE_RANGE.exec(header);
  if (!match) {
    return { kind: 'none' };
  }
  const [, first, last] = match;
  if (first === '' && last === '') {
    return { kind: 'none' };
  }

  if (first === '') {
    // suffix: the last N bytes
    const suffixLength = Number(last);
    if (suffixLength === 0 || totalBytes === 0) {
      return { kind: 'unsatisfiable' };
    }
    return {
      kind: 'partial',
      start: Math.max(totalBytes - suffixLength, 0),
      end: totalBytes - 1,
    };
  }

  const start = Number(first);
  const requestedEnd = last === '' ? totalBytes - 1 : Number(last);
  if (last !== '' && requestedEnd < start) {
    return { kind: 'none' }; // invalid byte-range-spec: ignored
  }
  if (start >= totalBytes) {
    return { kind: 'unsatisfiable' };
  }
  return {
    kind: 'partial',
    start,
    end: Math.min(requestedEnd, totalBytes - 1),
  };
}
