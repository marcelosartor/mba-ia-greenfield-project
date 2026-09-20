import { Test } from '@nestjs/testing';
import { VideosController } from '../videos/videos.controller';
import { VideosRepository } from '../videos/videos.repository';
import { MediaProbeService } from './media/media-probe.service';
import { ThumbnailService } from './media/thumbnail.service';
import { VideoProcessor } from './video.processor';
import { WorkerModule } from './worker.module';

describe('WorkerModule', () => {
  it('should resolve the processor dependencies without any HTTP controller', async () => {
    const module = await Test.createTestingModule({ imports: [WorkerModule] })
      // Keeps the queue consumer from starting: this only checks DI wiring.
      .overrideProvider(VideoProcessor)
      .useValue({})
      .compile();

    expect(module.get(VideosRepository)).toBeInstanceOf(VideosRepository);
    expect(module.get(MediaProbeService)).toBeInstanceOf(MediaProbeService);
    expect(module.get(ThumbnailService)).toBeInstanceOf(ThumbnailService);
    expect(() => module.get(VideosController, { strict: false })).toThrow();
    await module.close();
  }, 30000);

  it('should declare the processor as its only provider', () => {
    const providers = Reflect.getMetadata(
      'providers',
      WorkerModule,
    ) as unknown[];

    expect(providers).toEqual([VideoProcessor]);
    expect(Reflect.getMetadata('controllers', WorkerModule)).toBeUndefined();
  });
});
