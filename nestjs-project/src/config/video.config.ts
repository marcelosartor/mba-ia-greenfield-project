import { registerAs } from '@nestjs/config';

export default registerAs('video', () => ({
  partSizeBytes: parseInt(
    process.env.VIDEO_UPLOAD_PART_SIZE_BYTES || '67108864',
    10,
  ),
  workerConcurrency: parseInt(process.env.VIDEO_WORKER_CONCURRENCY || '1', 10),
  processingTimeoutMs: parseInt(
    process.env.VIDEO_PROCESSING_TIMEOUT_MS || '1800000',
    10,
  ),
  /** Width x height above which a custom thumbnail is refused undecoded. */
  thumbnailMaxPixels: parseInt(
    process.env.VIDEO_THUMBNAIL_MAX_PIXELS || '16777216',
    10,
  ),
  thumbnailDecodeTimeoutMs: parseInt(
    process.env.VIDEO_THUMBNAIL_TIMEOUT_MS || '5000',
    10,
  ),
}));
