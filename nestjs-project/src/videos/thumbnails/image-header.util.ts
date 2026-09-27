/** Image formats accepted as custom thumbnail, identified by their content. */
export type ImageFormat = 'jpeg' | 'png' | 'webp';

export interface ImageHeader {
  format: ImageFormat;
  width: number;
  height: number;
  /** Animated WebP (VP8X animation flag or ANIM chunk): refused. */
  animated: boolean;
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

// Start-of-frame markers carry the dimensions (C4, C8 and CC are not SOF).
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/**
 * Reads the format and the dimensions from the first bytes of an image,
 * without decoding it. Returns null when the content is not a JPEG, PNG or
 * WebP, or when its header is truncated or malformed.
 */
export function readImageHeader(buffer: Buffer): ImageHeader | null {
  if (isJpeg(buffer)) return readJpeg(buffer);
  if (isPng(buffer)) return readPng(buffer);
  if (isWebp(buffer)) return readWebp(buffer);
  return null;
}

function isJpeg(buffer: Buffer): boolean {
  return (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  );
}

function isPng(buffer: Buffer): boolean {
  return (
    buffer.length >= PNG_SIGNATURE.length &&
    buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  );
}

function isWebp(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  );
}

function readJpeg(buffer: Buffer): ImageHeader | null {
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    // Fill bytes and markers without a length field.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (offset + 9 > buffer.length) return null;
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return width > 0 && height > 0
        ? { format: 'jpeg', width, height, animated: false }
        : null;
    }
    offset += 2 + length;
  }
  return null;
}

function readPng(buffer: Buffer): ImageHeader | null {
  if (buffer.length < 24 || buffer.toString('ascii', 12, 16) !== 'IHDR') {
    return null;
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return width > 0 && height > 0
    ? { format: 'png', width, height, animated: false }
    : null;
}

function readWebp(buffer: Buffer): ImageHeader | null {
  if (buffer.length < 30) return null;
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    // Frame tag (3 bytes) + start code 9d 01 2a, then 14-bit sizes.
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) {
      return null;
    }
    const width = buffer.readUInt16LE(26) & 0x3fff;
    const height = buffer.readUInt16LE(28) & 0x3fff;
    return width > 0 && height > 0
      ? { format: 'webp', width, height, animated: false }
      : null;
  }
  if (chunk === 'VP8L') {
    if (buffer[20] !== 0x2f) return null;
    const bits = buffer.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { format: 'webp', width, height, animated: false };
  }
  if (chunk === 'VP8X') {
    const animated =
      (buffer[20] & 0x02) !== 0 || buffer.includes(Buffer.from('ANIM'), 30);
    const width = buffer.readUIntLE(24, 3) + 1;
    const height = buffer.readUIntLE(27, 3) + 1;
    return { format: 'webp', width, height, animated };
  }
  return null;
}
