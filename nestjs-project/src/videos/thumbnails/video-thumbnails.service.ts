import { Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { VideoNotFoundException } from '../../common/exceptions/domain.exception';
import { StorageService } from '../../storage/storage.service';
import { VideoAccessService } from '../video-access.service';
import { VideoOwnershipService } from '../video-ownership.service';
import { PRIVATE_NO_CACHE } from '../video-streaming.service';
import { VideosRepository } from '../videos.repository';
import { ImageNormalizerService } from './image-normalizer.service';

/** Key of the owner's cover in the `thumbnails` bucket. */
export function customThumbnailKey(videoId: string): string {
  return `${videoId}/custom.jpg`;
}

export interface VideoThumbnail {
  headers: Record<string, string>;
  body: Readable;
}

/** The cover of a video: the owner's custom one if any, else the generated. */
@Injectable()
export class VideoThumbnailsService {
  constructor(
    private readonly videoAccessService: VideoAccessService,
    private readonly storageService: StorageService,
    private readonly videoOwnershipService: VideoOwnershipService,
    private readonly imageNormalizerService: ImageNormalizerService,
    private readonly videosRepository: VideosRepository,
  ) {}

  /**
   * Streams the cover from the `thumbnails` bucket, under the read access
   * rules of the video (draft only for the owner, 404 before 409).
   */
  async getThumbnail(
    publicId: string,
    viewerUserId: string | undefined,
  ): Promise<VideoThumbnail> {
    const video = await this.videoAccessService.loadReadable(
      publicId,
      viewerUserId,
    );
    const key = video.custom_thumbnail_key ?? video.thumbnail_key;
    if (!key) {
      throw new VideoNotFoundException();
    }

    const object = await this.storageService.getObjectRange(
      this.storageService.thumbnailsBucket,
      key,
    );
    const headers: Record<string, string> = {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(object.contentLength),
      'Cache-Control': PRIVATE_NO_CACHE,
    };
    if (object.etag) {
      headers.ETag = object.etag;
    }
    return { headers, body: object.body };
  }

  /**
   * Replaces the cover with the owner's image, in any processing status. The
   * image is validated and re-encoded before it reaches the storage, and the
   * key is recorded only after the object is stored. The worker never writes
   * this key, so reprocessing keeps the custom cover.
   */
  async setCustom(
    userId: string,
    publicId: string,
    image: Buffer,
  ): Promise<void> {
    const video = await this.videoOwnershipService.loadOwned(userId, publicId);
    const jpeg = await this.imageNormalizerService.normalize(image);
    const key = customThumbnailKey(video.id);
    await this.storageService.putObject(
      this.storageService.thumbnailsBucket,
      key,
      jpeg,
      'image/jpeg',
    );
    await this.videosRepository.setCustomThumbnailKey(video.id, key);
  }

  /**
   * Back to the generated cover; idempotent. The key is cleared before the
   * object is removed, so a failure never leaves the video pointing at a
   * missing object.
   */
  async removeCustom(userId: string, publicId: string): Promise<void> {
    const video = await this.videoOwnershipService.loadOwned(userId, publicId);
    if (!video.custom_thumbnail_key) return;
    await this.videosRepository.setCustomThumbnailKey(video.id, null);
    await this.storageService.deleteObject(
      this.storageService.thumbnailsBucket,
      video.custom_thumbnail_key,
    );
  }
}
