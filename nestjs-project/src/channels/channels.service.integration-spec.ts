import { DataSource, Repository } from 'typeorm';
import { Category } from '../categories/entities/category.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import {
  ChannelNotFoundException,
  NicknameAlreadyExistsException,
} from '../common/exceptions/domain.exception';
import { ChannelsService } from './channels.service';
import { NICKNAME_PATTERN } from './nickname.util';
import { Channel } from './entities/channel.entity';
import { Video } from '../videos/entities/video.entity';

const ALL_ENTITIES = [
  User,
  Channel,
  RefreshToken,
  VerificationToken,
  Video,
  Category,
];

describe('ChannelsService (integration)', () => {
  let dataSource: DataSource;
  let channelsService: ChannelsService;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    channelsService = new ChannelsService(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  let userCounter = 0;
  async function createUser(): Promise<User> {
    return userRepository.save(
      userRepository.create({
        email: `ch_svc_${++userCounter}@example.com`,
        password: 'hashed',
      }),
    );
  }

  describe('createChannel', () => {
    it('persists a channel derived from email', async () => {
      const user = await createUser();

      const channel = await channelsService.createChannel(
        user.id,
        'mynick@example.com',
      );

      expect(channel.id).toBeDefined();
      expect(channel.nickname).toBe('mynick');
      expect(channel.name).toBe('mynick');
      expect(channel.user_id).toBe(user.id);

      const persisted = await channelRepository.findOneBy({ user_id: user.id });
      expect(persisted).not.toBeNull();
      expect(persisted!.nickname).toBe('mynick');
    });

    it('derives nickname from email prefix', async () => {
      const user = await createUser();

      const channel = await channelsService.createChannel(
        user.id,
        'John.Doe+tag@example.com',
      );

      expect(channel.nickname).toBe('johndoetag');
    });

    it('resolves nickname collision by appending a suffix', async () => {
      const user1 = await createUser();
      const user2 = await createUser();

      await channelsService.createChannel(user1.id, 'shared@example.com');
      const channel2 = await channelsService.createChannel(
        user2.id,
        'shared@example.com',
      );

      expect(channel2.nickname).toMatch(/^shared_[a-z0-9]{3}$/);

      const channels = await channelRepository.find();
      expect(channels).toHaveLength(2);
    });

    it('avoids a reserved nickname generated from the email prefix', async () => {
      const user = await createUser();

      const channel = await channelsService.createChannel(
        user.id,
        'admin@exemplo.com',
      );

      expect(channel.nickname).not.toBe('admin');
      expect(channel.nickname).toMatch(/^admin_[a-z0-9]{3}$/);
      expect(NICKNAME_PATTERN.test(channel.nickname)).toBe(true);
    });
  });

  describe('findByUserId', () => {
    it('returns the channel of the user', async () => {
      const user = await createUser();
      const created = await channelsService.createChannel(
        user.id,
        'finder@example.com',
      );

      const found = await channelsService.findByUserId(user.id);

      expect(found?.id).toBe(created.id);
    });

    it('returns null when the user has no channel', async () => {
      const user = await createUser();

      expect(await channelsService.findByUserId(user.id)).toBeNull();
    });
  });

  describe('updateOwn', () => {
    it('lets exactly one of two concurrent changes to the same nickname win', async () => {
      const [first, second] = [await createUser(), await createUser()];
      await channelsService.createChannel(first.id, 'first@example.com');
      await channelsService.createChannel(second.id, 'second@example.com');

      const results = await Promise.allSettled([
        channelsService.updateOwn(first.id, { nickname: 'disputado' }),
        channelsService.updateOwn(second.id, { nickname: 'disputado' }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(NicknameAlreadyExistsException);
      expect(await channelRepository.countBy({ nickname: 'disputado' })).toBe(
        1,
      );
    });
  });

  describe('findByNickname', () => {
    it('finds a legacy 2-character nickname and rejects an unknown one', async () => {
      const user = await createUser();
      await channelRepository.save({
        name: 'Legacy',
        nickname: 'ab',
        user_id: user.id,
      });

      await expect(channelsService.findByNickname('ab')).resolves.toMatchObject(
        { nickname: 'ab', name: 'Legacy' },
      );
      await expect(
        channelsService.findByNickname('inexistente'),
      ).rejects.toBeInstanceOf(ChannelNotFoundException);
    });
  });
});
