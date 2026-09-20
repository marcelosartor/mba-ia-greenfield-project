import { StorageService } from '../../src/storage/storage.service';
import { Video } from '../../src/videos/entities/video.entity';

/** Sends `sizeBytes` zero bytes to a presigned part URL and returns the ETag. */
export async function putPart(url: string, sizeBytes: number): Promise<string> {
  const response = await fetch(url, {
    method: 'PUT',
    body: Buffer.alloc(sizeBytes),
  });
  if (!response.ok) {
    throw new Error(`Part upload failed with status ${response.status}`);
  }
  return response.headers.get('etag') ?? '';
}

/**
 * Aborts the multipart uploads of the given videos so tests do not pile up
 * incomplete uploads in the storage. An upload that was already completed (or
 * aborted) is skipped: the storage answers NoSuchUpload for it.
 */
export async function abortOpenUploads(
  storage: StorageService,
  videos: Video[],
): Promise<void> {
  for (const video of videos) {
    if (!video.upload_id) {
      continue;
    }
    try {
      await storage.abortMultipartUpload(video.video_key, video.upload_id);
    } catch (error) {
      if ((error as { name?: string }).name !== 'NoSuchUpload') {
        throw error;
      }
    }
  }
}
