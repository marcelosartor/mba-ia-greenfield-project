import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import throttleConfig from './throttle.config';

const loadThrottleConfig = async (
  env: Record<string, string>,
): Promise<ConfigType<typeof throttleConfig>> => {
  delete process.env.THROTTLE_PUBLIC_READ_LIMIT;
  Object.assign(process.env, env);

  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ ignoreEnvFile: true, load: [throttleConfig] }),
    ],
  }).compile();

  const throttle = module.get<ConfigType<typeof throttleConfig>>(
    throttleConfig.KEY,
  );
  await module.close();
  return throttle;
};

describe('throttleConfig', () => {
  afterEach(() => {
    delete process.env.THROTTLE_PUBLIC_READ_LIMIT;
  });

  it('should read the public read limit from the environment', async () => {
    const throttle = await loadThrottleConfig({
      THROTTLE_PUBLIC_READ_LIMIT: '42',
    });

    expect(throttle).toEqual({ publicReadLimit: 42 });
  });

  it('should default the public read limit to 300 per minute', async () => {
    const throttle = await loadThrottleConfig({});

    expect(throttle).toEqual({ publicReadLimit: 300 });
  });
});
