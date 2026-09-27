import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import redisConfig from './redis.config';

const KEYS = ['REDIS_HOST', 'REDIS_PORT', 'QUEUE_PREFIX'] as const;

const loadConfigs = async (
  env: Partial<Record<(typeof KEYS)[number], string>>,
): Promise<{ redis: ConfigType<typeof redisConfig> }> => {
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, env);

  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        ignoreEnvFile: true,
        load: [redisConfig],
      }),
    ],
  }).compile();

  const redis = module.get<ConfigType<typeof redisConfig>>(redisConfig.KEY);
  await module.close();
  return { redis };
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
