import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  createStorageTestClient,
  deleteStoredObject,
} from '../../src/test/storage-test-client';
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
 * Uploads every part like a client would: asks the API for the presigned URLs
 * and sends `sizes[i]` bytes to the URL of part `partNumbers[i]`.
 */
export async function uploadParts(
  app: INestApplication<App>,
  token: string,
  publicId: string,
  parts: Record<number, number>,
): Promise<void> {
  const res = await request(app.getHttpServer())
    .post(`/videos/${publicId}/upload/parts`)
    .set('Authorization', `Bearer ${token}`)
    .send({ part_numbers: Object.keys(parts).map(Number) })
    .expect(201);
  const issued = (res.body as { parts: { part_number: number; url: string }[] })
    .parts;
  for (const { part_number, url } of issued) {
    await putPart(url, parts[part_number]);
  }
}

/**
 * Removes what the videos left in the storage: open multipart uploads are
 * aborted (an upload already completed or aborted answers NoSuchUpload and is
 * skipped) and the completed source object, if any, is deleted.
 */
export async function discardStoredUploads(
  storage: StorageService,
  videos: Video[],
): Promise<void> {
  const client = createStorageTestClient();
  try {
    for (const video of videos) {
      if (video.upload_id) {
        try {
          await storage.abortMultipartUpload(video.video_key, video.upload_id);
        } catch (error) {
          if ((error as { name?: string }).name !== 'NoSuchUpload') {
            throw error;
          }
        }
      }
      await deleteStoredObject(client, storage.videosBucket, video.video_key);
    }
  } finally {
    client.destroy();
  }
}
