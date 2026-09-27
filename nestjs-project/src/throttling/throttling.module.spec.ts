import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  getOptionsToken,
  ThrottlerStorage,
  type ThrottlerModuleOptions,
} from '@nestjs/throttler';
import throttleConfig from '../config/throttle.config';
import { ThrottlingModule } from './throttling.module';

describe('ThrottlingModule', () => {
  it('compiles and exposes the four named throttlers and the storage', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [throttleConfig],
        }),
        ThrottlingModule,
      ],
    }).compile();

    const options = module.get<ThrottlerModuleOptions>(getOptionsToken());
    const names = Array.isArray(options)
      ? []
      : options.throttlers.map((t) => t.name);
    expect(names).toEqual([
      'default',
      'public-read',
      'authenticated',
      'uploads',
    ]);
    expect(module.get(ThrottlerStorage)).toBeDefined();
    await module.close();
  });
});
