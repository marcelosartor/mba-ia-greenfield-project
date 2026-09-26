import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import videoConfig from '../../config/video.config';
import { MediaProbeService } from './media-probe.service';
import { MediaModule } from './media.module';
import { ThumbnailService } from './thumbnail.service';

describe('MediaModule', () => {
  it('should compile and provide the probe and thumbnail services', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [videoConfig],
        }),
        MediaModule,
      ],
    }).compile();

    expect(module.get(MediaProbeService)).toBeInstanceOf(MediaProbeService);
    expect(module.get(ThumbnailService)).toBeInstanceOf(ThumbnailService);
    await module.close();
  });
});
