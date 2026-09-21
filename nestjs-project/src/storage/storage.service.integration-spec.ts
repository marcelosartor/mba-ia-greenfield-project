import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

jest.setTimeout(60000);

const MIB = 1024 * 1024;

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

describe('StorageService (integration)', () => {
  let module: TestingModule;
  let storage: StorageService;
  let config: ConfigType<typeof storageConfig>;
  let cleanupClient: S3Client;
  const created: { bucket: string; key: string }[] = [];

  const newKey = (bucket: string, name: string): string => {
    const key = `test-storage/${randomUUID()}/${name}`;
    created.push({ bucket, key });
    return key;
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [storageConfig],
        }),
        StorageModule,
      ],
    }).compile();

    storage = module.get(StorageService);
    config = module.get<ConfigType<typeof storageConfig>>(storageConfig.KEY);
    cleanupClient = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  });

  afterAll(async () => {
    for (const { bucket, key } of created) {
      await cleanupClient.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: key }),
      );
    }
    cleanupClient.destroy();
    await module.close();
  });

  describe('multipart upload through presigned URLs', () => {
    it('should upload two parts, complete the object and read it back by range', async () => {
      const key = newKey(storage.videosBucket, 'source.mp4');
      const part1 = randomBytes(5 * MIB);
      const part2 = randomBytes(1000);
      const uploadId = await storage.createMultipartUpload(key, 'video/mp4');

      for (const [partNumber, body] of [
        [1, part1],
        [2, part2],
      ] as const) {
        const url = await storage.presignUploadPart(key, uploadId, partNumber);
        const response = await fetch(url, { method: 'PUT', body });
        expect(response.status).toBe(200);
      }

      const parts = await storage.listParts(key, uploadId);
      expect(parts.map((p) => [p.partNumber, p.sizeBytes])).toEqual([
        [1, 5 * MIB],
        [2, 1000],
      ]);

      await storage.completeMultipartUpload(
        key,
        uploadId,
        parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })),
      );

      const total = 5 * MIB + 1000;
      const head = await storage.headObject(storage.videosBucket, key);
      expect(head.contentLength).toBe(total);

      const range = await storage.getObjectRange(
        storage.videosBucket,
        key,
        'bytes=0-1023',
      );
      const body = await streamToBuffer(range.body);
      expect(body.length).toBe(1024);
      expect(body.equals(part1.subarray(0, 1024))).toBe(true);
      expect(range.contentLength).toBe(1024);
      expect(range.contentRange).toBe(`bytes 0-1023/${total}`);
    });

    it('should make the listing fail and leave no object after an abort', async () => {
      const key = newKey(storage.videosBucket, 'aborted.mp4');
      const uploadId = await storage.createMultipartUpload(key, 'video/mp4');

      await storage.abortMultipartUpload(key, uploadId);

      await expect(storage.listParts(key, uploadId)).rejects.toThrow();
      await expect(
        storage.headObject(storage.videosBucket, key),
      ).rejects.toThrow();
    });
  });

  describe('presigned GET', () => {
    it('should let the object be read over HTTP without credentials, through the service host', async () => {
      const key = newKey(storage.thumbnailsBucket, 'default.jpg');
      const content = randomBytes(2048);
      await storage.putObject(
        storage.thumbnailsBucket,
        key,
        content,
        'image/jpeg',
      );

      const url = await storage.presignGetObject(storage.thumbnailsBucket, key);

      expect(new URL(url).hostname).toBe('minio');
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer()).equals(content)).toBe(
        true,
      );
    });
  });

  describe('unreachable storage', () => {
    it('should fail with STORAGE_UNAVAILABLE (502) when the endpoint cannot be reached', async () => {
      const unreachable = new StorageService({
        ...config,
        endpoint: 'http://storage-down:9000',
      });

      await expect(
        unreachable.createMultipartUpload('x/source.mp4', 'video/mp4'),
      ).rejects.toMatchObject({
        errorCode: 'STORAGE_UNAVAILABLE',
        httpStatus: 502,
      });
    });
  });
});
