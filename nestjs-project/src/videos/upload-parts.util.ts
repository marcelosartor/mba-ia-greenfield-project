/** Number of parts of an upload: `ceil(size / part size)`. */
export function partCountFor(sizeBytes: number, partSizeBytes: number): number {
  return Math.ceil(sizeBytes / partSizeBytes);
}

/**
 * Exact length of part `partNumber` (1-based): every part is `partSizeBytes`
 * long except the last, which carries the rest.
 */
export function expectedPartLength(
  sizeBytes: number,
  partSizeBytes: number,
  partNumber: number,
): number {
  const count = partCountFor(sizeBytes, partSizeBytes);
  return partNumber < count
    ? partSizeBytes
    : sizeBytes - (count - 1) * partSizeBytes;
}
