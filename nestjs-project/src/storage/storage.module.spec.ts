import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

describe('StorageModule', () => {
  it('should compile and expose StorageService', async () => {
    process.env.STORAGE_ACCESS_KEY_ID = 'key-id';
    process.env.STORAGE_SECRET_ACCESS_KEY = 'key-secret';

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [storageConfig],
        }),
        StorageModule,
      ],
    }).compile();

    const service = module.get(StorageService);

    expect(service).toBeInstanceOf(StorageService);
    expect(service.videosBucket).toBe('videos');
    expect(service.thumbnailsBucket).toBe('thumbnails');
    await module.close();
  });
});
