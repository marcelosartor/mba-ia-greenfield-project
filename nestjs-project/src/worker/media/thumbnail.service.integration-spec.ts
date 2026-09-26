import type { S3Client } from '@aws-sdk/client-s3';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import storageConfig from '../../config/storage.config';
import videoConfig from '../../config/video.config';
import { StorageModule } from '../../storage/storage.module';
import { StorageService } from '../../storage/storage.service';
import {
  hlsPlaylistPointingTo,
  startHitRecorder,
} from '../../test/internal-server';
import {
  averageLuma,
  generateVideo,
  type Container,
  generateBlackThenWhiteMp4,
  generateMp4,
  readJpegSize,
} from '../../test/media-fixtures';
import {
  createStorageTestClient,
  deleteStoredObject,
} from '../../test/storage-test-client';
import { InvalidMediaError, TransientMediaError } from './media.errors';
import { ThumbnailService } from './thumbnail.service';

jest.setTimeout(60000);

const leftovers = async (): Promise<string[]> =>
  (await readdir(tmpdir())).filter((name) =>
    name.startsWith('streamtube-thumbnail-'),
  );

describe('ThumbnailService (integration)', () => {
  let module: TestingModule;
  let storage: StorageService;
  let thumbnails: ThumbnailService;
  let cleanupClient: S3Client;
  const stored: string[] = [];

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [storageConfig, videoConfig],
        }),
        StorageModule,
      ],
      providers: [ThumbnailService],
    }).compile();
    storage = module.get(StorageService);
    thumbnails = module.get(ThumbnailService);
    cleanupClient = createStorageTestClient();
  });

  afterAll(async () => {
    for (const key of stored) {
      await deleteStoredObject(cleanupClient, storage.videosBucket, key);
    }
    cleanupClient.destroy();
    await module.close();
  });

  const storeAndSign = async (body: Buffer): Promise<string> => {
    const key = `test-media/${randomUUID()}/source.mp4`;
    stored.push(key);
    await storage.putObject(storage.videosBucket, key, body, 'video/mp4');
    return storage.presignGetObject(storage.videosBucket, key, 300);
  };

  it('should produce a JPEG 640 px wide with the aspect ratio preserved', async () => {
    const url = await storeAndSign(await generateMp4({ durationSeconds: 12 }));

    const image = await thumbnails.generate(url, 12);

    expect(image.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(readJpegSize(image)).toEqual({ width: 640, height: 480 });
    expect(await leftovers()).toEqual([]);
  });

  it('should capture the frame at 10% of the duration', async () => {
    // black for 0.5 s, then white: the frame at 1 s (10% of 10 s) is white
    const url = await storeAndSign(await generateBlackThenWhiteMp4(0.5, 9.5));

    const atTenPercent = await thumbnails.generate(url, 10);
    const atStart = await thumbnails.generate(url, null);

    expect(await averageLuma(atTenPercent)).toBeGreaterThan(200);
    expect(await averageLuma(atStart)).toBeLessThan(50);
  });

  it('should reject a corrupted file as invalid media and leave no temporary file', async () => {
    const url = await storeAndSign(randomBytes(4096));

    await expect(thumbnails.generate(url, 5)).rejects.toBeInstanceOf(
      InvalidMediaError,
    );
    expect(await leftovers()).toEqual([]);
  });

  it('should reject a file without a video track as invalid media', async () => {
    const url = await storeAndSign(
      await generateMp4({ durationSeconds: 2, withVideo: false }),
    );

    await expect(thumbnails.generate(url, 2)).rejects.toBeInstanceOf(
      InvalidMediaError,
    );
  });

  it('should treat an unreadable source as transient', async () => {
    const missing = await storage.presignGetObject(
      storage.videosBucket,
      `test-media/${randomUUID()}/missing.mp4`,
      300,
    );

    await expect(thumbnails.generate(missing, 5)).rejects.toBeInstanceOf(
      TransientMediaError,
    );
    expect(await leftovers()).toEqual([]);
  });

  it('should treat an aborted call as transient', async () => {
    const url = await storeAndSign(await generateMp4({ durationSeconds: 1 }));

    await expect(
      thumbnails.generate(url, 1, AbortSignal.abort()),
    ).rejects.toBeInstanceOf(TransientMediaError);
    expect(await leftovers()).toEqual([]);
  });

  it.each(['mp4', 'mov', 'mkv', 'webm'] as Container[])(
    'should still make a thumbnail of a real %s file',
    async (container) => {
      const url = await storeAndSign(await generateVideo(container));

      const image = await thumbnails.generate(url, 2);

      expect(readJpegSize(image)).toEqual({ width: 640, height: 480 });
    },
  );

  it('should not follow the URLs of a playlist uploaded as an mp4 (SSRF)', async () => {
    const internal = await startHitRecorder();
    try {
      const url = await storeAndSign(hlsPlaylistPointingTo(internal.url));

      await expect(thumbnails.generate(url, 1)).rejects.toBeInstanceOf(
        InvalidMediaError,
      );

      expect(internal.hits).toEqual([]);
    } finally {
      await internal.close();
    }
  });
});
