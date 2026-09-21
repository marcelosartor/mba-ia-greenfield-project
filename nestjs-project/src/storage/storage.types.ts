import type { Readable } from 'node:stream';

export interface StorageUploadedPart {
  partNumber: number;
  sizeBytes: number;
  etag: string;
}

export interface StorageCompletedPart {
  partNumber: number;
  etag: string;
}

export interface StorageObjectHead {
  contentLength: number;
  contentType?: string;
  etag?: string;
}

export interface StorageObjectRange {
  body: Readable;
  contentLength: number;
  contentRange?: string;
  contentType?: string;
  etag?: string;
  acceptRanges?: string;
}
