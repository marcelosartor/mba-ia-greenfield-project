import {
  ALLOWED_INPUT_FORMATS,
  SAFE_INPUT_OPTIONS,
  classifyToolFailure,
  redactUrls,
} from './media-tool';
import { InvalidMediaError, TransientMediaError } from './media.errors';

describe('classifyToolFailure', () => {
  it.each([
    'http://minio:9000/videos/a?X-Amz-Signature=abc: Server returned 403 Forbidden (access denied)',
    'Connection refused',
    'Failed to resolve hostname minio: Temporary failure in name resolution',
    'Input/output error',
  ])('should treat a remote read failure as transient: %s', (stderr) => {
    expect(classifyToolFailure(stderr)).toBeInstanceOf(TransientMediaError);
  });

  it.each([
    'Invalid data found when processing input',
    'moov atom not found',
    'Error opening input file http://x: Invalid data found when processing input',
  ])('should treat a broken file as invalid media: %s', (stderr) => {
    expect(classifyToolFailure(stderr)).toBeInstanceOf(InvalidMediaError);
  });

  it('should never keep a presigned URL in the message', () => {
    const error = classifyToolFailure(
      'http://minio:9000/videos/a.mp4?X-Amz-Signature=secret: Invalid data found',
    );

    expect(error.message).not.toContain('secret');
    expect(error.message).toContain('<url>');
  });

  it('should cap the message length', () => {
    expect(classifyToolFailure('x'.repeat(5000)).message.length).toBe(500);
  });

  it('should have a default message for an empty stderr', () => {
    expect(classifyToolFailure('  ').message).not.toBe('');
  });
});

describe('redactUrls', () => {
  it('should replace every URL', () => {
    expect(redactUrls('a http://x/y?z=1 b https://q/r c')).toBe(
      'a <url> b <url> c',
    );
  });
});

describe('SAFE_INPUT_OPTIONS', () => {
  it('should whitelist only the containers the upload accepts', () => {
    expect(ALLOWED_INPUT_FORMATS.split(',').sort()).toEqual([
      'matroska',
      'mov',
      'mp4',
      'webm',
    ]);
    const index = SAFE_INPUT_OPTIONS.indexOf('-format_whitelist');
    expect(SAFE_INPUT_OPTIONS[index + 1]).toBe(ALLOWED_INPUT_FORMATS);
  });

  it('should not allow playlist demuxers or protocols beyond HTTP(S)', () => {
    const joined = SAFE_INPUT_OPTIONS.join(' ');

    expect(joined).not.toMatch(/hls|dash|concat|file|ftp|rtmp|rtsp|data/i);
  });
});
