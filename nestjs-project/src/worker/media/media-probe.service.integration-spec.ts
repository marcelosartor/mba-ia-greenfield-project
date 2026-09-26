import type { S3Client } from '@aws-sdk/client-s3';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import storageConfig from '../../config/storage.config';
import videoConfig from '../../config/video.config';
import { StorageModule } from '../../storage/storage.module';
import { StorageService } from '../../storage/storage.service';
import {
  generateMp4,
  generateVideo,
  type Container,
} from '../../test/media-fixtures';
import {
  hlsPlaylistPointingTo,
  startHitRecorder,
} from '../../test/internal-server';
import {
  createStorageTestClient,
  deleteStoredObject,
} from '../../test/storage-test-client';
import { MediaProbeService } from './media-probe.service';
import { InvalidMediaError, TransientMediaError } from './media.errors';

jest.setTimeout(60000);

describe('MediaProbeService (integration)', () => {
  let module: TestingModule;
  let storage: StorageService;
  let probeService: MediaProbeService;
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
      providers: [MediaProbeService],
    }).compile();
    storage = module.get(StorageService);
    probeService = module.get(MediaProbeService);
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

  it('should read duration, dimensions and codecs of a real MP4 through a presigned URL', async () => {
    const file = await generateMp4({ durationSeconds: 3 });
    const url = await storeAndSign(file);

    const result = await probeService.probe(url);

    expect(result.duration_seconds).toBeCloseTo(3, 0);
    expect(result).toMatchObject({
      width: 320,
      height: 240,
      video_codec: 'h264',
      audio_codec: 'aac',
      size_bytes: file.length,
    });
    expect(result.format_name).toContain('mp4');
    expect(result.bit_rate).toBeGreaterThan(0);
  });

  it('should probe a file whose index is at the end without downloading it', async () => {
    const file = await generateMp4({ durationSeconds: 3 });
    // no faststart: the moov atom comes after the media data
    expect(file.indexOf('moov')).toBeGreaterThan(file.indexOf('mdat'));
    const url = await storeAndSign(file);
    const before = new Set(await readdir(tmpdir()));

    const result = await probeService.probe(url);

    expect(result.width).toBe(320);
    const created = (await readdir(tmpdir())).filter(
      (name) => !before.has(name),
    );
    expect(created).toEqual([]);
  });

  it('should leave audio_codec null for a video without audio', async () => {
    const url = await storeAndSign(
      await generateMp4({ durationSeconds: 2, withAudio: false }),
    );

    const result = await probeService.probe(url);

    expect(result.audio_codec).toBeNull();
    expect(result.video_codec).toBe('h264');
  });

  it('should reject a corrupted file as invalid media', async () => {
    const url = await storeAndSign(randomBytes(4096));

    await expect(probeService.probe(url)).rejects.toBeInstanceOf(
      InvalidMediaError,
    );
  });

  it('should reject a truncated MP4 as invalid media', async () => {
    const file = await generateMp4({ durationSeconds: 3 });
    const url = await storeAndSign(file.subarray(0, file.length - 200));

    await expect(probeService.probe(url)).rejects.toBeInstanceOf(
      InvalidMediaError,
    );
  });

  it('should reject a file without a video track as invalid media', async () => {
    const url = await storeAndSign(
      await generateMp4({ durationSeconds: 2, withVideo: false }),
    );

    await expect(probeService.probe(url)).rejects.toBeInstanceOf(
      InvalidMediaError,
    );
  });

  it('should treat an unreadable source as transient and keep the URL out of the message', async () => {
    const missing = await storage.presignGetObject(
      storage.videosBucket,
      `test-media/${randomUUID()}/missing.mp4`,
      300,
    );

    const failure = await probeService.probe(missing).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(TransientMediaError);
    expect((failure as Error).message).not.toContain('X-Amz-Signature');
  });

  it('should treat a timeout as transient', async () => {
    const url = await storeAndSign(await generateMp4({ durationSeconds: 1 }));
    const impatient = new MediaProbeService({
      ...module.get<ConfigType<typeof videoConfig>>(videoConfig.KEY),
      processingTimeoutMs: 1,
    });

    await expect(impatient.probe(url)).rejects.toBeInstanceOf(
      TransientMediaError,
    );
  });

  it('should treat an aborted call as transient', async () => {
    const url = await storeAndSign(await generateMp4({ durationSeconds: 1 }));

    await expect(
      probeService.probe(url, AbortSignal.abort()),
    ).rejects.toBeInstanceOf(TransientMediaError);
  });

  it('should refuse to open a local file', async () => {
    await expect(
      probeService.probe('file:///etc/passwd'),
    ).rejects.toBeInstanceOf(InvalidMediaError);
  });

  it.each(['mp4', 'mov', 'mkv', 'webm'] as Container[])(
    'should still probe a real %s file',
    async (container) => {
      const url = await storeAndSign(await generateVideo(container));

      const result = await probeService.probe(url);

      expect(result).toMatchObject({ width: 160, height: 120 });
    },
  );

  it('should not follow the URLs of a playlist uploaded as an mp4 (SSRF)', async () => {
    const internal = await startHitRecorder();
    try {
      const url = await storeAndSign(hlsPlaylistPointingTo(internal.url));

      await expect(probeService.probe(url)).rejects.toBeInstanceOf(
        InvalidMediaError,
      );

      expect(internal.hits).toEqual([]);
    } finally {
      await internal.close();
    }
  });
});
