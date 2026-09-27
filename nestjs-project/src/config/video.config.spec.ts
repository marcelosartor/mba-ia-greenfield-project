import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import videoConfig from './video.config';

const KEYS = [
  'VIDEO_UPLOAD_PART_SIZE_BYTES',
  'VIDEO_WORKER_CONCURRENCY',
  'VIDEO_PROCESSING_TIMEOUT_MS',
  'VIDEO_THUMBNAIL_MAX_PIXELS',
  'VIDEO_THUMBNAIL_TIMEOUT_MS',
] as const;

const loadVideoConfig = async (
  env: Partial<Record<(typeof KEYS)[number], string>>,
): Promise<ConfigType<typeof videoConfig>> => {
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, env);

  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ ignoreEnvFile: true, load: [videoConfig] }),
    ],
  }).compile();

  const video = module.get<ConfigType<typeof videoConfig>>(videoConfig.KEY);
  await module.close();
  return video;
};

describe('videoConfig', () => {
  afterEach(() => {
    for (const key of KEYS) delete process.env[key];
  });

  it('should read the video settings from the environment', async () => {
    const video = await loadVideoConfig({
      VIDEO_UPLOAD_PART_SIZE_BYTES: '5242880',
      VIDEO_WORKER_CONCURRENCY: '3',
      VIDEO_PROCESSING_TIMEOUT_MS: '60000',
      VIDEO_THUMBNAIL_MAX_PIXELS: '1000000',
      VIDEO_THUMBNAIL_TIMEOUT_MS: '2000',
    });

    expect(video).toEqual({
      partSizeBytes: 5242880,
      workerConcurrency: 3,
      processingTimeoutMs: 60000,
      thumbnailMaxPixels: 1000000,
      thumbnailDecodeTimeoutMs: 2000,
    });
  });

  it('should default to a 64 MiB part size, one worker, a 30 min timeout and the thumbnail limits', async () => {
    const video = await loadVideoConfig({});

    expect(video).toEqual({
      partSizeBytes: 67108864,
      workerConcurrency: 1,
      processingTimeoutMs: 1800000,
      thumbnailMaxPixels: 16777216,
      thumbnailDecodeTimeoutMs: 5000,
    });
  });
});
