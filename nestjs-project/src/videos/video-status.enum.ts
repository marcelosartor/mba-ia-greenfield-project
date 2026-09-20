export enum VideoStatus {
  DRAFT = 'draft',
  PROCESSING = 'processing',
  READY = 'ready',
  ERROR = 'error',
}

export const VIDEO_STATUS_VALUES: readonly VideoStatus[] =
  Object.values(VideoStatus);
