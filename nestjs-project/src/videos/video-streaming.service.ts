import { Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import {
  InvalidRangeException,
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import { StorageService } from '../storage/storage.service';
import { parseRange } from './range.util';
import { VideoStatus } from './video-status.enum';
import { VideosRepository } from './videos.repository';

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

export interface VideoStream {
  statusCode: 200 | 206;
  headers: Record<string, string>;
  body: Readable;
}

@Injectable()
export class VideoStreamingService {
  constructor(
    private readonly videosRepository: VideosRepository,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Streams the video from the object storage through the API, honouring a
   * single-range `Range` header. The body is the storage stream itself: the
   * file is never loaded into the memory of the API.
   */
  async stream(
    publicId: string,
    rangeHeader: string | undefined,
  ): Promise<VideoStream> {
    const video = await this.videosRepository.findByPublicId(publicId);
    if (!video) {
      throw new VideoNotFoundException();
    }
    if (video.status !== VideoStatus.READY) {
      throw new VideoNotReadyException();
    }

    const bucket = this.storageService.videosBucket;
    const head = await this.storageService.headObject(bucket, video.video_key);
    const totalBytes = head.contentLength;
    const range = parseRange(rangeHeader, totalBytes);
    if (range.kind === 'unsatisfiable') {
      throw new InvalidRangeException(totalBytes);
    }

    const object = await this.storageService.getObjectRange(
      bucket,
      video.video_key,
      range.kind === 'partial'
        ? `bytes=${range.start}-${range.end}`
        : undefined,
    );

    const headers: Record<string, string> = {
      'Content-Type':
        object.contentType ?? head.contentType ?? DEFAULT_CONTENT_TYPE,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    };
    const etag = object.etag ?? head.etag;
    if (etag) {
      headers.ETag = etag;
    }

    if (range.kind === 'partial') {
      headers['Content-Range'] =
        `bytes ${range.start}-${range.end}/${totalBytes}`;
      headers['Content-Length'] = String(range.end - range.start + 1);
      return { statusCode: 206, headers, body: object.body };
    }
    headers['Content-Length'] = String(totalBytes);
    return { statusCode: 200, headers, body: object.body };
  }
}
