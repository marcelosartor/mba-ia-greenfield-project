import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import redisConfig from './redis.config';
import videoConfig from './video.config';

const KEYS = [
  'REDIS_HOST',
  'REDIS_PORT',
  'QUEUE_PREFIX',
  'VIDEO_UPLOAD_PART_SIZE_BYTES',
  'VIDEO_WORKER_CONCURRENCY',
  'VIDEO_PROCESSING_TIMEOUT_MS',
] as const;

const loadConfigs = async (
  env: Partial<Record<(typeof KEYS)[number], string>>,
): Promise<{
  redis: ConfigType<typeof redisConfig>;
  video: ConfigType<typeof videoConfig>;
}> => {
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, env);

  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        ignoreEnvFile: true,
        load: [redisConfig, videoConfig],
      }),
    ],
  }).compile();

  const redis = module.get<ConfigType<typeof redisConfig>>(redisConfig.KEY);
  const video = module.get<ConfigType<typeof videoConfig>>(videoConfig.KEY);
  await module.close();
  return { redis, video };
};

describe('redisConfig', () => {
  afterEach(() => {
    for (const key of KEYS) delete process.env[key];
  });

  it('should read the host and port from the environment', async () => {
    const { redis } = await loadConfigs({
      REDIS_HOST: 'queue',
      REDIS_PORT: '6380',
      QUEUE_PREFIX: 'my-prefix',
    });

    expect(redis).toEqual({
      host: 'queue',
      port: 6380,
      queuePrefix: 'my-prefix',
    });
  });

  it('should default to the Compose service name, port 6379 and the bull prefix', async () => {
    const { redis } = await loadConfigs({});

    expect(redis).toEqual({ host: 'redis', port: 6379, queuePrefix: 'bull' });
  });
});

describe('videoConfig', () => {
  afterEach(() => {
    for (const key of KEYS) delete process.env[key];
  });

  it('should read the video settings from the environment', async () => {
    const { video } = await loadConfigs({
      VIDEO_UPLOAD_PART_SIZE_BYTES: '5242880',
      VIDEO_WORKER_CONCURRENCY: '3',
      VIDEO_PROCESSING_TIMEOUT_MS: '60000',
    });

    expect(video).toEqual({
      partSizeBytes: 5242880,
      workerConcurrency: 3,
      processingTimeoutMs: 60000,
    });
  });

  it('should default to a 64 MiB part size, one worker and a 30 min timeout', async () => {
    const { video } = await loadConfigs({});

    expect(video).toEqual({
      partSizeBytes: 67108864,
      workerConcurrency: 1,
      processingTimeoutMs: 1800000,
    });
  });
});
