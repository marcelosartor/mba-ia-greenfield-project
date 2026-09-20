export const VIDEO_FORMATS = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
} as const;

export const MAX_VIDEO_SIZE_BYTES = 10_737_418_240;

export const UPLOAD_URL_EXPIRATION_SECONDS = 3600;

export const MAX_VIDEO_TITLE_LENGTH = 100;

export const MAX_PARTS_PER_REQUEST = 100;

// S3 and MinIO accept part numbers from 1 to 10000.
export const MAX_PART_NUMBER = 10_000;
