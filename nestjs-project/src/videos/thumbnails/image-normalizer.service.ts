import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { InvalidImageException } from '../../common/exceptions/domain.exception';
import videoConfig from '../../config/video.config';
import { readImageHeader, type ImageFormat } from './image-header.util';

export const CUSTOM_THUMBNAIL_WIDTH_PX = 640;
// Largest single allocation ffmpeg may make while decoding (chosen by the
// Phase 04 plan): a 16-megapixel RGBA frame is 64 MiB.
const MAX_ALLOC_BYTES = 128 * 1024 * 1024;
// A 640 px wide JPEG is far below this; anything larger is not our output.
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

// The demuxer is forced by the sniffed format and the input is stdin only:
// the image equivalent of SAFE_INPUT_OPTIONS (no probing, no network).
const DEMUXER: Record<ImageFormat, string> = {
  jpeg: 'jpeg_pipe',
  png: 'png_pipe',
  webp: 'webp_pipe',
};

/**
 * Validates an uploaded image by its content and re-encodes it as a JPEG
 * 640 px wide (drops EXIF and anything appended to the file). The upload is
 * untrusted: the pixel cap is checked on the header before any decoding, and
 * ffmpeg runs without a shell, with an allocation limit and a timeout.
 */
@Injectable()
export class ImageNormalizerService {
  constructor(
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  /** @throws InvalidImageException for anything that is not a valid image. */
  async normalize(image: Buffer): Promise<Buffer> {
    const header = readImageHeader(image);
    if (
      !header ||
      header.animated ||
      header.width * header.height > this.config.thumbnailMaxPixels
    ) {
      throw new InvalidImageException();
    }
    return this.runFfmpeg(image, DEMUXER[header.format]);
  }

  private runFfmpeg(image: Buffer, demuxer: string): Promise<Buffer> {
    const args = [
      '-v',
      'error',
      '-nostdin',
      '-protocol_whitelist',
      'pipe',
      '-max_alloc',
      String(MAX_ALLOC_BYTES),
      '-f',
      demuxer,
      '-i',
      'pipe:0',
      '-frames:v',
      '1',
      '-vf',
      `scale=${CUSTOM_THUMBNAIL_WIDTH_PX}:-2`,
      '-c:v',
      'mjpeg',
      '-f',
      'image2',
      'pipe:1',
    ];

    return new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', args, {
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const chunks: Buffer[] = [];
      let size = 0;
      let failed = false;

      const fail = () => {
        if (failed) return;
        failed = true;
        clearTimeout(timer);
        child.kill('SIGKILL');
        reject(new InvalidImageException());
      };

      const timer = setTimeout(fail, this.config.thumbnailDecodeTimeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_OUTPUT_BYTES) return fail();
        chunks.push(chunk);
      });
      child.on('error', fail);
      child.on('close', (code) => {
        if (failed) return;
        clearTimeout(timer);
        if (code !== 0 || size === 0) {
          failed = true;
          return reject(new InvalidImageException());
        }
        resolve(Buffer.concat(chunks));
      });
      // ffmpeg may exit before reading all of stdin (invalid data): ignore EPIPE.
      child.stdin.on('error', () => undefined);
      child.stdin.end(image);
    });
  }
}
