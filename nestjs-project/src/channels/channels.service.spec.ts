import { BadRequestException } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import {
  ChannelNotFoundException,
  NicknameAlreadyExistsException,
  NicknameReservedException,
} from '../common/exceptions/domain.exception';
import { ChannelsService } from './channels.service';
import { Channel } from './entities/channel.entity';

interface MockManager {
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
}

function makeManager(overrides: Partial<MockManager> = {}): MockManager {
  return {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    ...overrides,
  };
}

function makeChannel(nickname: string): Channel {
  const c = new Channel();
  c.id = 'uuid';
  c.nickname = nickname;
  c.name = nickname;
  c.user_id = 'user-id';
  c.description = null;
  c.created_at = new Date();
  c.updated_at = new Date();
  return c;
}

function makeUniqueError(): QueryFailedError {
  return Object.assign(new QueryFailedError('INSERT', [], new Error()), {
    code: '23505',
    detail: 'Key (nickname)=(abc) already exists.',
  });
}

function makeDataSource(manager: MockManager): DataSource {
  return {
    transaction: jest.fn((cb: (manager: EntityManager) => Promise<unknown>) =>
      cb(manager as unknown as EntityManager),
    ),
  } as unknown as DataSource;
}

describe('ChannelsService', () => {
  describe('createChannel', () => {
    it('derives nickname from email prefix and saves when no collision', async () => {
      const channel = makeChannel('test');
      const manager = makeManager({
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockReturnValue(channel),
        save: jest.fn().mockResolvedValue(channel),
      });
      const service = new ChannelsService(makeDataSource(manager));

      const result = await service.createChannel('user-id', 'test@example.com');

      expect(manager.findOne).toHaveBeenCalledWith(Channel, {
        where: { nickname: 'test' },
      });
      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(result.nickname).toBe('test');
    });

    it('retries with suffix when pre-check finds existing nickname', async () => {
      const colliding = makeChannel('john');
      const resolved = makeChannel('john_abc');
      const manager = makeManager({
        findOne: jest
          .fn()
          .mockResolvedValueOnce(colliding)
          .mockResolvedValueOnce(null),
        create: jest.fn().mockReturnValue(resolved),
        save: jest.fn().mockResolvedValue(resolved),
      });
      const service = new ChannelsService(makeDataSource(manager));

      const result = await service.createChannel('user-id', 'john@example.com');

      expect(manager.findOne).toHaveBeenCalledTimes(2);
      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(result.nickname).toMatch(/^john_[a-z0-9]{3}$/);
    });

    it('retries with suffix on concurrent unique constraint violation', async () => {
      const resolved = makeChannel('alice_abc');
      const manager = makeManager({
        findOne: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        create: jest.fn().mockReturnValue(resolved),
        save: jest
          .fn()
          .mockRejectedValueOnce(makeUniqueError())
          .mockResolvedValueOnce(resolved),
      });
      const service = new ChannelsService(makeDataSource(manager));

      const result = await service.createChannel(
        'user-id',
        'alice@example.com',
      );

      expect(manager.save).toHaveBeenCalledTimes(2);
      expect(result.nickname).toMatch(/^alice/);
    });

    it('throws after exhausting max retries', async () => {
      const existing = makeChannel('bob');
      const manager = makeManager({
        findOne: jest.fn().mockResolvedValue(existing),
        create: jest.fn(),
        save: jest.fn(),
      });
      const service = new ChannelsService(makeDataSource(manager));

      await expect(
        service.createChannel('user-id', 'bob@example.com'),
      ).rejects.toThrow(
        'Nickname conflict could not be resolved after max retries',
      );
    });

    it('re-throws non-unique-constraint errors immediately', async () => {
      const unexpectedError = new Error('Connection lost');
      const channel = makeChannel('carol');
      const manager = makeManager({
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockReturnValue(channel),
        save: jest.fn().mockRejectedValue(unexpectedError),
      });
      const service = new ChannelsService(makeDataSource(manager));

      await expect(
        service.createChannel('user-id', 'carol@example.com'),
      ).rejects.toThrow('Connection lost');
      expect(manager.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateOwn', () => {
    let repository: {
      findOneBy: jest.Mock;
      update: jest.Mock;
      findOneByOrFail: jest.Mock;
    };
    let service: ChannelsService;

    beforeEach(() => {
      repository = {
        findOneBy: jest.fn().mockResolvedValue(makeChannel('before')),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
        findOneByOrFail: jest.fn().mockResolvedValue(makeChannel('after')),
      };
      service = new ChannelsService({
        getRepository: () => repository,
      } as unknown as DataSource);
    });

    it('rejects an empty body', async () => {
      await expect(service.updateOwn('user-id', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('rejects a reserved nickname before touching the database', async () => {
      await expect(
        service.updateOwn('user-id', { nickname: 'admin' }),
      ).rejects.toBeInstanceOf(NicknameReservedException);
      expect(repository.findOneBy).not.toHaveBeenCalled();
    });

    it('answers channel not found for a user without a channel', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(
        service.updateOwn('user-id', { name: 'X' }),
      ).rejects.toBeInstanceOf(ChannelNotFoundException);
    });

    it('turns the UNIQUE violation on nickname into NICKNAME_ALREADY_EXISTS', async () => {
      repository.update.mockRejectedValue(makeUniqueError());

      await expect(
        service.updateOwn('user-id', { nickname: 'taken_nick' }),
      ).rejects.toBeInstanceOf(NicknameAlreadyExistsException);
    });

    it('writes only the fields that came in the body', async () => {
      await service.updateOwn('user-id', { description: null });

      expect(repository.update).toHaveBeenCalledWith(
        { id: 'uuid' },
        { description: null },
      );
    });
  });
});
