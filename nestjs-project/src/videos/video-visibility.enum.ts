/** Who can find a published video: `public` is listed, `unlisted` only by link. */
export enum VideoVisibility {
  PUBLIC = 'public',
  UNLISTED = 'unlisted',
}

export const VIDEO_VISIBILITY_VALUES = Object.values(VideoVisibility);
