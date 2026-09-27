import { readImageHeader } from './image-header.util';

const png = (width: number, height: number): Buffer => {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
};

const jpeg = (width: number, height: number): Buffer =>
  Buffer.from([
    0xff,
    0xd8, // SOI
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00, // APP0 with a 2-byte payload
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08, // SOF0, length 17, precision 8
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);

const webpChunk = (fourcc: string, payload: Buffer): Buffer => {
  const buffer = Buffer.alloc(20 + payload.length);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WEBP', 8, 'ascii');
  buffer.write(fourcc, 12, 'ascii');
  buffer.writeUInt32LE(payload.length, 16);
  payload.copy(buffer, 20);
  return buffer;
};

const webpLossy = (width: number, height: number): Buffer => {
  const payload = Buffer.alloc(10);
  Buffer.from([0x9d, 0x01, 0x2a]).copy(payload, 3);
  payload.writeUInt16LE(width, 6);
  payload.writeUInt16LE(height, 8);
  return webpChunk('VP8 ', payload);
};

const webpLossless = (width: number, height: number): Buffer => {
  const payload = Buffer.alloc(10);
  payload[0] = 0x2f;
  payload.writeUInt32LE(((height - 1) << 14) | (width - 1), 1);
  return webpChunk('VP8L', payload);
};

const webpExtended = (width: number, height: number, animated: boolean) => {
  const payload = Buffer.alloc(10);
  payload[0] = animated ? 0x02 : 0x00;
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  return webpChunk('VP8X', payload);
};

describe('readImageHeader', () => {
  it('reads the dimensions of a PNG', () => {
    expect(readImageHeader(png(800, 600))).toEqual({
      format: 'png',
      width: 800,
      height: 600,
      animated: false,
    });
  });

  it('reads the dimensions of a JPEG from its start-of-frame segment', () => {
    expect(readImageHeader(jpeg(1920, 1080))).toEqual({
      format: 'jpeg',
      width: 1920,
      height: 1080,
      animated: false,
    });
  });

  it.each([
    ['lossy', webpLossy(640, 480)],
    ['lossless', webpLossless(640, 480)],
    ['extended', webpExtended(640, 480, false)],
  ])('reads the dimensions of a %s WebP', (_kind, image) => {
    expect(readImageHeader(image)).toMatchObject({
      format: 'webp',
      width: 640,
      height: 480,
      animated: false,
    });
  });

  it('flags an animated WebP', () => {
    expect(readImageHeader(webpExtended(100, 100, true))?.animated).toBe(true);
  });

  it('refuses text, even named like an image', () => {
    expect(readImageHeader(Buffer.from('not an image at all'))).toBeNull();
  });

  it.each([
    ['PNG', png(800, 600).subarray(0, 20)],
    ['JPEG', jpeg(800, 600).subarray(0, 10)],
    ['WebP', webpLossy(800, 600).subarray(0, 24)],
  ])('refuses a truncated %s header', (_kind, image) => {
    expect(readImageHeader(image)).toBeNull();
  });
});
