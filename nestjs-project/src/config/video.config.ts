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
}));
