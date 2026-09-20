import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Readable } from 'node:stream';
import { StorageUnavailableException } from '../common/exceptions/domain.exception';
import storageConfig from '../config/storage.config';
import type {
  StorageCompletedPart,
  StorageObjectHead,
  StorageObjectRange,
  StorageUploadedPart,
} from './storage.types';

const PRESIGNED_URL_EXPIRATION_SECONDS = 3600;

const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ETIMEDOUT',
]);

// The SDK re-wraps errors it cannot recognize as `Error` (for example, errors
// coming from another realm) into "AWS SDK error wrapper for ...", which drops
// the `code`; the original message is all that is left to classify them.
const NETWORK_ERROR_MESSAGE =
  /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ETIMEDOUT|getaddrinfo|socket hang up/i;

@Injectable()
export class StorageService {
  private readonly client: S3Client;

  constructor(
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  get videosBucket(): string {
    return this.config.videosBucket;
  }

  get thumbnailsBucket(): string {
    return this.config.thumbnailsBucket;
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const response = await this.run(() =>
      this.client.send(
        new CreateMultipartUploadCommand({
          Bucket: this.videosBucket,
          Key: key,
          ContentType: contentType,
        }),
      ),
    );
    if (!response.UploadId) {
      throw new StorageUnavailableException();
    }
    return response.UploadId;
  }

  async presignUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresInSeconds: number = PRESIGNED_URL_EXPIRATION_SECONDS,
  ): Promise<string> {
    return this.run(() =>
      getSignedUrl(
        this.client,
        new UploadPartCommand({
          Bucket: this.videosBucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: expiresInSeconds },
      ),
    );
  }

  async listParts(
    key: string,
    uploadId: string,
  ): Promise<StorageUploadedPart[]> {
    const parts: StorageUploadedPart[] = [];
    let marker: string | undefined;

    do {
      const page = await this.run(() =>
        this.client.send(
          new ListPartsCommand({
            Bucket: this.videosBucket,
            Key: key,
            UploadId: uploadId,
            PartNumberMarker: marker,
          }),
        ),
      );
      for (const part of page.Parts ?? []) {
        parts.push({
          partNumber: part.PartNumber ?? 0,
          sizeBytes: part.Size ?? 0,
          etag: part.ETag ?? '',
        });
      }
      marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
    } while (marker !== undefined);

    return parts;
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: StorageCompletedPart[],
  ): Promise<void> {
    await this.run(() =>
      this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.videosBucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map((part) => ({
              PartNumber: part.partNumber,
              ETag: part.etag,
            })),
          },
        }),
      ),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.run(() =>
      this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.videosBucket,
          Key: key,
          UploadId: uploadId,
        }),
      ),
    );
  }

  async presignGetObject(
    bucket: string,
    key: string,
    expiresInSeconds: number = PRESIGNED_URL_EXPIRATION_SECONDS,
  ): Promise<string> {
    return this.run(() =>
      getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: expiresInSeconds },
      ),
    );
  }

  async putObject(
    bucket: string,
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.run(() =>
      this.client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      ),
    );
  }

  async headObject(bucket: string, key: string): Promise<StorageObjectHead> {
    const response = await this.run(() =>
      this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })),
    );
    return {
      contentLength: response.ContentLength ?? 0,
      contentType: response.ContentType,
      etag: response.ETag,
    };
  }

  async getObjectRange(
    bucket: string,
    key: string,
    range?: string,
  ): Promise<StorageObjectRange> {
    const response = await this.run(() =>
      this.client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }),
      ),
    );
    return {
      body: response.Body as Readable,
      contentLength: response.ContentLength ?? 0,
      contentRange: response.ContentRange,
      contentType: response.ContentType,
      etag: response.ETag,
      acceptRanges: response.AcceptRanges,
    };
  }

  /**
   * Runs a storage call and turns communication failures (network errors and
   * 5xx answers) into StorageUnavailableException. Answers that mean something
   * about the request itself (4xx such as NoSuchUpload or InvalidRange) and
   * unrelated programming errors are rethrown untouched.
   */
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (this.isCommunicationFailure(error)) {
        throw new StorageUnavailableException();
      }
      throw error;
    }
  }

  private isCommunicationFailure(error: unknown): boolean {
    if (error instanceof S3ServiceException) {
      const status = error.$metadata?.httpStatusCode;
      return status === undefined || status >= 500;
    }
    if (error instanceof Error) {
      const code = (error as Error & { code?: string }).code;
      return (
        error.name === 'TimeoutError' ||
        (code !== undefined && NETWORK_ERROR_CODES.has(code)) ||
        NETWORK_ERROR_MESSAGE.test(error.message)
      );
    }
    return false;
  }
}
