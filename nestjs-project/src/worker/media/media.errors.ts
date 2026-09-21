/**
 * Failures of the media tools. The processor turns `InvalidMediaError` into a
 * non-retryable failure and retries everything else.
 */
export abstract class MediaError extends Error {
  abstract readonly retryable: boolean;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** The file is not a readable video: retrying cannot help. */
export class InvalidMediaError extends MediaError {
  readonly retryable = false;
}

/** Timeout or failure reading the remote source: a retry may succeed. */
export class TransientMediaError extends MediaError {
  readonly retryable = true;
}
