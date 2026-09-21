export const QUEUE_NAMES = {
  VIDEO_PROCESSING: 'video-processing',
  VIDEO_PROCESSING_DLQ: 'video-processing-dlq',
  VIDEO_MAINTENANCE: 'video-maintenance',
} as const;

export const JOB_NAMES = {
  PROCESS_VIDEO: 'process-video',
  DEAD_LETTERED_VIDEO: 'dead-lettered-video',
  SWEEP_ABANDONED_UPLOADS: 'sweep-abandoned-uploads',
} as const;

export const SWEEPER_SCHEDULER_ID = 'abandoned-uploads-sweep';

export const VIDEO_PROCESSING_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
} as const;
