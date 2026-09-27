import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Category } from '../../categories/entities/category.entity';
import { Video } from '../entities/video.entity';
import { VideoListingsModule } from './video-listings.module';
import { VideoListingsService } from './video-listings.service';

describe('VideoListingsModule', () => {
  it('should compile and provide VideoListingsService', async () => {
    const module = await Test.createTestingModule({
      imports: [VideoListingsModule],
    })
      .overrideProvider(getRepositoryToken(Video))
      .useValue({})
      .overrideProvider(getRepositoryToken(Category))
      .useValue({})
      .compile();

    expect(module.get(VideoListingsService)).toBeInstanceOf(
      VideoListingsService,
    );
    await module.close();
  });
});
