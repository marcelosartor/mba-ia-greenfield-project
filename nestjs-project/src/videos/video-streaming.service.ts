import { Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { InvalidRangeException } from '../common/exceptions/domain.exception';
import { StorageService } from '../storage/storage.service';
import {
  buildContentDisposition,
  buildDownloadFilename,
} from './filename.util';
import { parseRange } from './range.util';
import { VideoAccessService } from './video-access.service';

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
/** Reads depend on who asks (draft vs published): never a shared cache. */
export const PRIVATE_NO_CACHE = 'private, no-cache';

export interface VideoStream {
  statusCode: 200 | 206;
  headers: Record<string, string>;
  body: Readable;
}

export interface VideoDownload {
  headers: Record<string, string>;
  body: Readable;
}

@Injectable()
export class VideoStreamingService {
  constructor(
    private readonly storageService: StorageService,
    private readonly videoAccessService: VideoAccessService,
  ) {}

  /**
   * Streams the video from the object storage through the API, honouring a
   * single-range `Range` header. The body is the storage stream itself: the
   * file is never loaded into the memory of the API.
   */
  async stream(
    publicId: string,
    rangeHeader: string | undefined,
    viewerUserId?: string,
  ): Promise<VideoStream> {
    const video = await this.videoAccessService.loadReadable(
      publicId,
      viewerUserId,
    );

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
      'Cache-Control': PRIVATE_NO_CACHE,
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

  /** The whole file as an attachment, streamed from the object storage. */
  async download(
    publicId: string,
    viewerUserId?: string,
  ): Promise<VideoDownload> {
    const video = await this.videoAccessService.loadReadable(
      publicId,
      viewerUserId,
    );

    const object = await this.storageService.getObjectRange(
      this.storageService.videosBucket,
      video.video_key,
    );

    const headers: Record<string, string> = {
      'Content-Type': object.contentType ?? DEFAULT_CONTENT_TYPE,
      'Content-Length': String(object.contentLength),
      'Content-Disposition': buildContentDisposition(
        buildDownloadFilename(video.title, video.video_key),
      ),
      'Cache-Control': PRIVATE_NO_CACHE,
    };
    if (object.etag) {
      headers.ETag = object.etag;
    }
    return { headers, body: object.body };
  }
}
