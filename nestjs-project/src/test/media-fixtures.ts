import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface FixtureOptions {
  durationSeconds?: number;
  width?: number;
  height?: number;
  withVideo?: boolean;
  withAudio?: boolean;
}

/**
 * Generates a real MP4 with ffmpeg's synthetic sources. The muxer writes the
 * index (`moov`) at the end of the file, like a phone recording without
 * `faststart`.
 */
export async function generateMp4(
  options: FixtureOptions = {},
): Promise<Buffer> {
  const {
    durationSeconds = 3,
    width = 320,
    height = 240,
    withVideo = true,
    withAudio = true,
  } = options;
  const output = join(tmpdir(), `streamtube-fixture-${randomUUID()}.mp4`);
  const args = ['-v', 'error', '-y'];
  if (withVideo) {
    args.push(
      '-f',
      'lavfi',
      '-i',
      `testsrc=duration=${durationSeconds}:size=${width}x${height}:rate=25`,
    );
  }
  if (withAudio) {
    args.push(
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=${durationSeconds}`,
    );
  }
  if (withVideo) {
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p');
  }
  if (withAudio) {
    args.push('-c:a', 'aac');
  }
  args.push(output);

  try {
    await execFileAsync('ffmpeg', args);
    return await readFile(output);
  } finally {
    await rm(output, { force: true });
  }
}

/** Reads the pixel size from the first start-of-frame marker of a JPEG. */
export function readJpegSize(image: Buffer): { width: number; height: number } {
  let offset = 2;
  while (offset < image.length) {
    if (image[offset] !== 0xff) {
      throw new Error('Not a JPEG: marker expected');
    }
    const marker = image[offset + 1];
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame) {
      return {
        height: image.readUInt16BE(offset + 5),
        width: image.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + image.readUInt16BE(offset + 2);
  }
  throw new Error('JPEG without a start-of-frame marker');
}

/** MP4 whose first `blackSeconds` are black and the rest white. */
export async function generateBlackThenWhiteMp4(
  blackSeconds: number,
  whiteSeconds: number,
): Promise<Buffer> {
  const output = join(tmpdir(), `streamtube-fixture-${randomUUID()}.mp4`);
  const filter =
    `color=c=black:s=320x240:r=25:d=${blackSeconds}[black];` +
    `color=c=white:s=320x240:r=25:d=${whiteSeconds}[white];` +
    '[black][white]concat=n=2:v=1:a=0[out]';
  try {
    await execFileAsync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-filter_complex',
      filter,
      '-map',
      '[out]',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      output,
    ]);
    return await readFile(output);
  } finally {
    await rm(output, { force: true });
  }
}

/** Average brightness (0 = black, 255 = white) of a JPEG, decoded by ffmpeg. */
export async function averageLuma(image: Buffer): Promise<number> {
  const input = join(tmpdir(), `streamtube-luma-${randomUUID()}.jpg`);
  try {
    await writeFile(input, image);
    const { stdout } = await execFileAsync(
      'ffmpeg',
      ['-v', 'error', '-i', input, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
    );
    return stdout.reduce((sum, value) => sum + value, 0) / stdout.length;
  } finally {
    await rm(input, { force: true });
  }
}

export type Container = 'mp4' | 'mov' | 'mkv' | 'webm';

/** A real short video in the given container (the formats the upload accepts). */
export async function generateVideo(container: Container): Promise<Buffer> {
  if (container === 'mp4') {
    return generateMp4({ durationSeconds: 2, width: 160, height: 120 });
  }
  const output = join(
    tmpdir(),
    `streamtube-fixture-${randomUUID()}.${container}`,
  );
  const args =
    container === 'webm'
      ? ['-c:v', 'libvpx', '-f', 'webm']
      : [
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-f',
          container === 'mov' ? 'mov' : 'matroska',
        ];
  try {
    await execFileAsync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=2:size=160x120:rate=10',
      ...args,
      output,
    ]);
    return await readFile(output);
  } finally {
    await rm(output, { force: true });
  }
}
