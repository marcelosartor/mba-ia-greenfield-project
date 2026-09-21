import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import videoConfig from '../../config/video.config';
import { INPUT_PROTOCOLS, runMediaTool } from './media-tool';
import { mapProbeOutput } from './media-probe.mapper';
import { InvalidMediaError } from './media.errors';
import type { FfprobeOutput, MediaMetadata } from './media.types';

@Injectable()
export class MediaProbeService {
  constructor(
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  /**
   * Reads duration and stream metadata straight from a presigned URL: ffprobe
   * fetches only the bytes it needs (ranges), the file is never downloaded.
   * @throws InvalidMediaError when the file is not a readable video.
   * @throws TransientMediaError on timeout or when the source cannot be read.
   */
  async probe(url: string, signal?: AbortSignal): Promise<MediaMetadata> {
    const stdout = await runMediaTool(
      'ffprobe',
      [
        '-v',
        'error',
        ...INPUT_PROTOCOLS,
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        url,
      ],
      this.config.processingTimeoutMs,
      signal,
    );

    let output: FfprobeOutput;
    try {
      output = JSON.parse(stdout) as FfprobeOutput;
    } catch {
      throw new InvalidMediaError('ffprobe returned an unreadable answer');
    }
    return mapProbeOutput(output);
  }
}
