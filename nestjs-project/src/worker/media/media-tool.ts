import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { InvalidMediaError, TransientMediaError } from './media.errors';

const execFileAsync = promisify(execFile);

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_ERROR_MESSAGE_LENGTH = 500;

// The uploaded file is untrusted: only its extension and declared type are
// checked at upload, so its content decides what ffmpeg/ffprobe would do with
// it. An HLS or DASH playlist named `a.mp4` would make them fetch every URL it
// lists from the worker's network (SSRF), so the demuxers are restricted to
// the containers the upload accepts (mp4, mov, mkv, webm), and the protocols
// to the HTTP(S) of the presigned source URL.
export const ALLOWED_INPUT_FORMATS = 'mov,mp4,matroska,webm';
export const ALLOWED_INPUT_PROTOCOLS = 'http,https,tcp,tls,crypto';

/** Input options every ffmpeg/ffprobe call on an uploaded file must carry. */
export const SAFE_INPUT_OPTIONS = [
  '-format_whitelist',
  ALLOWED_INPUT_FORMATS,
  '-protocol_whitelist',
  ALLOWED_INPUT_PROTOCOLS,
];

// stderr of ffprobe/ffmpeg when the remote source cannot be read (as opposed
// to being read and found to be broken).
const REMOTE_READ_FAILURE =
  /Server returned|HTTP error|Connection (refused|reset|timed out)|Input\/output error|Name or service not known|Temporary failure in name resolution|Network is unreachable|Operation timed out|Broken pipe/i;

/**
 * Presigned URLs carry the signature in the query string, so they must never
 * end up in an error message (stored in the database and logged).
 */
export function redactUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/gi, '<url>');
}

export function classifyToolFailure(stderr: string): Error {
  const message = redactUrls(stderr.trim()).slice(0, MAX_ERROR_MESSAGE_LENGTH);
  return REMOTE_READ_FAILURE.test(stderr)
    ? new TransientMediaError(message || 'Could not read the remote source')
    : new InvalidMediaError(message || 'The file is not a valid video');
}

interface ExecFailure extends Error {
  code?: number | string;
  killed?: boolean;
  signal?: string | null;
  stderr?: string;
}

function toMediaError(binary: string, error: unknown): Error {
  const failure = error as ExecFailure;
  if (failure.name === 'AbortError' || failure.killed || failure.signal) {
    return new TransientMediaError(`${binary} timed out or was aborted`);
  }
  if (failure.code === 'ENOENT') {
    return new Error(`${binary} is not installed`);
  }
  if (typeof failure.stderr === 'string' && failure.stderr.length > 0) {
    return classifyToolFailure(failure.stderr);
  }
  return failure instanceof Error ? failure : new Error(String(error));
}

/** Runs a media tool without a shell and maps its failures to media errors. */
export async function runMediaTool(
  binary: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(binary, args, {
      timeout: timeoutMs,
      signal,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    return stdout;
  } catch (error) {
    throw toMediaError(binary, error);
  }
}
