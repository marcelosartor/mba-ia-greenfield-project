import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import videoConfig from '../../config/video.config';
import { INPUT_PROTOCOLS, runMediaTool } from './media-tool';
import { InvalidMediaError } from './media.errors';

export const THUMBNAIL_WIDTH_PX = 640;
export const THUMBNAIL_MAX_SEEK_SECONDS = 10;
const THUMBNAIL_SEEK_FRACTION = 0.1;

/** Frame to capture: 10% of the duration, at most 10 s (0 when unknown). */
export function thumbnailSeekSeconds(durationSeconds: number | null): number {
  if (durationSeconds === null || durationSeconds <= 0) {
    return 0;
  }
  return Math.min(
    durationSeconds * THUMBNAIL_SEEK_FRACTION,
    THUMBNAIL_MAX_SEEK_SECONDS,
  );
}

@Injectable()
export class ThumbnailService {
  constructor(
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  /**
   * Captures one frame from a presigned URL as a JPEG 640 px wide (aspect
   * ratio preserved). The frame goes through a temporary file that is read and
   * always removed.
   * @throws InvalidMediaError when no frame can be produced.
   * @throws TransientMediaError on timeout or when the source cannot be read.
   */
  async generate(
    url: string,
    durationSeconds: number | null,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    const outputPath = join(
      tmpdir(),
      `streamtube-thumbnail-${randomUUID()}.jpg`,
    );
    try {
      await runMediaTool(
        'ffmpeg',
        [
          '-v',
          'error',
          '-nostdin',
          ...INPUT_PROTOCOLS,
          '-ss',
          thumbnailSeekSeconds(durationSeconds).toFixed(3),
          '-i',
          url,
          '-frames:v',
          '1',
          '-vf',
          `scale=${THUMBNAIL_WIDTH_PX}:-1`,
          '-y',
          outputPath,
        ],
        this.config.processingTimeoutMs,
        signal,
      );

      const image = await readFile(outputPath).catch(() => null);
      if (!image || image.length === 0) {
        throw new InvalidMediaError('No frame could be extracted');
      }
      return image;
    } finally {
      await rm(outputPath, { force: true });
    }
  }
}
