import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import throttleConfig from '../config/throttle.config';
import { buildThrottlerOptions } from './throttling.options';

/**
 * Named throttlers of the API. The guards are registered by AuthModule, in the
 * order JwtAuthGuard → ThrottlerGuard, so the per-user trackers see `req.user`.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [throttleConfig.KEY],
      useFactory: (config: ConfigType<typeof throttleConfig>) =>
        buildThrottlerOptions(config.publicReadLimit),
    }),
  ],
  exports: [ThrottlerModule],
})
export class ThrottlingModule {}
