import { UnrecoverableError } from 'bullmq';

/**
 * Raised by the processor once an invalid file already ended the video in
 * `error`. It is a subclass of BullMQ's `UnrecoverableError` (so the remaining
 * attempts are skipped) that the `failed` handler can tell apart from the
 * `UnrecoverableError` BullMQ itself raises when a job stalled more often than
 * allowed, which is a failure nothing has recorded yet.
 */
export class InvalidMediaJobFailure extends UnrecoverableError {}
