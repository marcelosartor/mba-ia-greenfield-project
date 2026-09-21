import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import storageConfig from './storage.config';

const STORAGE_KEYS = [
  'STORAGE_ENDPOINT',
  'STORAGE_REGION',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
  'STORAGE_BUCKET_VIDEOS',
  'STORAGE_BUCKET_THUMBNAILS',
  'STORAGE_PUBLIC_ENDPOINT',
] as const;

const loadConfig = async (
  env: Partial<Record<(typeof STORAGE_KEYS)[number], string>>,
): Promise<ConfigType<typeof storageConfig>> => {
  for (const key of STORAGE_KEYS) delete process.env[key];
  Object.assign(process.env, env);

  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ ignoreEnvFile: true, load: [storageConfig] }),
    ],
  }).compile();

  const config = module.get<ConfigType<typeof storageConfig>>(
    storageConfig.KEY,
  );
  await module.close();
  return config;
};

describe('storageConfig', () => {
  afterEach(() => {
    for (const key of STORAGE_KEYS) delete process.env[key];
  });

  it('should read every value from the environment', async () => {
    const config = await loadConfig({
      STORAGE_ENDPOINT: 'http://storage:9000',
      STORAGE_REGION: 'sa-east-1',
      STORAGE_ACCESS_KEY_ID: 'key-id',
      STORAGE_SECRET_ACCESS_KEY: 'key-secret',
      STORAGE_BUCKET_VIDEOS: 'my-videos',
      STORAGE_BUCKET_THUMBNAILS: 'my-thumbs',
      STORAGE_PUBLIC_ENDPOINT: 'http://files.example.test:9000',
    });

    expect(config).toEqual({
      endpoint: 'http://storage:9000',
      region: 'sa-east-1',
      accessKeyId: 'key-id',
      secretAccessKey: 'key-secret',
      videosBucket: 'my-videos',
      thumbnailsBucket: 'my-thumbs',
      publicEndpoint: 'http://files.example.test:9000',
    });
  });

  it('should default the endpoint and buckets to the Compose service names', async () => {
    const config = await loadConfig({
      STORAGE_ACCESS_KEY_ID: 'key-id',
      STORAGE_SECRET_ACCESS_KEY: 'key-secret',
    });

    expect(config.endpoint).toBe('http://minio:9000');
    expect(config.region).toBe('us-east-1');
    expect(config.videosBucket).toBe('videos');
    expect(config.thumbnailsBucket).toBe('thumbnails');
  });

  it('should leave publicEndpoint undefined by default', async () => {
    const config = await loadConfig({
      STORAGE_ACCESS_KEY_ID: 'key-id',
      STORAGE_SECRET_ACCESS_KEY: 'key-secret',
    });

    expect(config.publicEndpoint).toBeUndefined();
  });
});
