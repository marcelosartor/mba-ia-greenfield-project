import { S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import type { ConfigType } from '@nestjs/config';
import { StorageUnavailableException } from '../common/exceptions/domain.exception';
import type storageConfig from '../config/storage.config';
import { StorageService } from './storage.service';

const config: ConfigType<typeof storageConfig> = {
  endpoint: 'http://minio:9000',
  region: 'us-east-1',
  accessKeyId: 'key-id',
  secretAccessKey: 'key-secret',
  videosBucket: 'videos',
  thumbnailsBucket: 'thumbnails',
  publicEndpoint: undefined,
};

const s3Error = (name: string, httpStatusCode: number): S3ServiceException =>
  new S3ServiceException({
    name,
    $fault: httpStatusCode >= 500 ? 'server' : 'client',
    $metadata: { httpStatusCode },
    message: name,
  });

describe('StorageService', () => {
  let service: StorageService;
  let send: jest.SpyInstance;

  beforeEach(() => {
    service = new StorageService(config);
    send = jest.spyOn(S3Client.prototype as any, 'send');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('communication failures', () => {
    it('should map a network error to StorageUnavailableException', async () => {
      send.mockRejectedValueOnce(
        Object.assign(new Error('connect ECONNREFUSED'), {
          code: 'ECONNREFUSED',
        }),
      );

      await expect(
        service.createMultipartUpload('a/b/source.mp4', 'video/mp4'),
      ).rejects.toMatchObject({
        errorCode: 'STORAGE_UNAVAILABLE',
        httpStatus: 502,
      });
    });

    it('should map the SDK wrapper of a DNS failure to StorageUnavailableException', async () => {
      send.mockRejectedValueOnce(
        new Error('AWS SDK error wrapper for Error: getaddrinfo EAI_AGAIN x'),
      );

      await expect(
        service.createMultipartUpload('a/b/source.mp4', 'video/mp4'),
      ).rejects.toBeInstanceOf(StorageUnavailableException);
    });

    it('should map a timeout to StorageUnavailableException', async () => {
      const timeout = new Error('timed out');
      timeout.name = 'TimeoutError';
      send.mockRejectedValueOnce(timeout);

      await expect(
        service.headObject('videos', 'a/b/source.mp4'),
      ).rejects.toBeInstanceOf(StorageUnavailableException);
    });

    it('should map a 5xx storage answer to StorageUnavailableException', async () => {
      send.mockRejectedValueOnce(s3Error('InternalError', 503));

      await expect(
        service.abortMultipartUpload('a/b/source.mp4', 'upload-1'),
      ).rejects.toBeInstanceOf(StorageUnavailableException);
    });
  });

  describe('errors that are not communication failures', () => {
    it('should rethrow a 4xx storage answer untouched', async () => {
      const notFound = s3Error('NoSuchUpload', 404);
      send.mockRejectedValueOnce(notFound);

      await expect(
        service.listParts('a/b/source.mp4', 'upload-1'),
      ).rejects.toBe(notFound);
    });

    it('should rethrow an unrelated programming error untouched', async () => {
      const bug = new TypeError('boom');
      send.mockRejectedValueOnce(bug);

      await expect(
        service.putObject(
          'thumbnails',
          'a/default.jpg',
          Buffer.from('x'),
          'image/jpeg',
        ),
      ).rejects.toBe(bug);
    });
  });

  describe('listParts', () => {
    it('should follow pagination until the listing is not truncated', async () => {
      send
        .mockResolvedValueOnce({
          IsTruncated: true,
          NextPartNumberMarker: '2',
          Parts: [
            { PartNumber: 1, Size: 5, ETag: '"a"' },
            { PartNumber: 2, Size: 5, ETag: '"b"' },
          ],
        })
        .mockResolvedValueOnce({
          IsTruncated: false,
          Parts: [{ PartNumber: 3, Size: 2, ETag: '"c"' }],
        });

      const parts = await service.listParts('a/b/source.mp4', 'upload-1');

      expect(parts).toEqual([
        { partNumber: 1, sizeBytes: 5, etag: '"a"' },
        { partNumber: 2, sizeBytes: 5, etag: '"b"' },
        { partNumber: 3, sizeBytes: 2, etag: '"c"' },
      ]);
      expect(send).toHaveBeenCalledTimes(2);
      const calls = send.mock.calls as [
        { input: { PartNumberMarker?: string } },
      ][];
      expect(calls[1][0].input.PartNumberMarker).toBe('2');
    });
  });
});
