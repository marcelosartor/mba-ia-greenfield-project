const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** A draft whose upload was never completed is abandoned after this long. */
export const ABANDONED_UPLOAD_AGE_MS = 24 * HOUR_MS;

/**
 * A completed upload still in `draft` gets its job republished after this
 * grace, long enough for the request that completed it to publish on its own.
 */
export const COMPLETED_UPLOAD_GRACE_MS = 5 * MINUTE_MS;

/**
 * A video in `processing` is presumed stuck after this long without being
 * touched. A live run refreshes `updated_at` on every attempt and lasts at most
 * two media calls (probe and thumbnail), each bounded by the processing
 * timeout; the margin covers the queue backoff between attempts.
 */
export const processingStuckAfterMs = (processingTimeoutMs: number): number =>
  2 * processingTimeoutMs + 5 * MINUTE_MS;

export const SWEEP_INTERVAL_MS = 15 * MINUTE_MS;

/** Videos handled per category in one run; the next run takes the rest. */
export const SWEEP_BATCH_SIZE = 200;
