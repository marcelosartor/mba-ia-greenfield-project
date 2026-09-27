import { Test } from '@nestjs/testing';
import { Category } from '../categories/entities/category.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { createTestDataSource } from '../test/create-test-data-source';
import { Channel } from '../channels/entities/channel.entity';
import { User } from './entities/user.entity';
import { UsersModule } from './users.module';
import { Video } from '../videos/entities/video.entity';

const ALL_ENTITIES = [
  User,
  Channel,
  RefreshToken,
  VerificationToken,
  Video,
  Category,
];

describe('UsersModule', () => {
  it('should compile successfully', async () => {
    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        UsersModule,
      ],
    }).compile();

    expect(module).toBeDefined();
    await module.close();
  }, 30000);
});
