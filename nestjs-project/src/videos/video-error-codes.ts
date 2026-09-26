/** Values stored in `videos.error_code` when the worker ends a video in `error`. */
export const VIDEO_ERROR_CODES = {
  INVALID_MEDIA: 'INVALID_MEDIA',
  PROCESSING_FAILED: 'PROCESSING_FAILED',
} as const;

export const MAX_ERROR_MESSAGE_LENGTH = 500;
