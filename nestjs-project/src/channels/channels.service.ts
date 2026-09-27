import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import {
  ChannelNotFoundException,
  NicknameAlreadyExistsException,
  NicknameReservedException,
} from '../common/exceptions/domain.exception';
import type { UpdateChannelDto } from './dto/update-channel.dto';
import {
  appendRandomSuffix,
  isReservedNickname,
  sanitizeNickname,
} from './nickname.util';
import { Channel } from './entities/channel.entity';

const PG_UNIQUE_VIOLATION = '23505';
const NICKNAME_COLUMN = 'nickname';
const MAX_RETRIES = 5;

function isPgUniqueViolationOnColumn(err: unknown, column: string): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const e = err as QueryFailedError & { code?: string; detail?: string };
  return (
    e.code === PG_UNIQUE_VIOLATION &&
    typeof e.detail === 'string' &&
    e.detail.includes(column)
  );
}

@Injectable()
export class ChannelsService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Public lookup by nickname. Any stored nickname resolves, even one that
   * predates the Phase 04 rules (short or reserved).
   * @throws ChannelNotFoundException when no channel has this nickname.
   */
  async findByNickname(nickname: string): Promise<Channel> {
    const channel = await this.dataSource
      .getRepository(Channel)
      .findOneBy({ nickname });
    if (!channel) {
      throw new ChannelNotFoundException();
    }
    return channel;
  }

  async findByUserId(userId: string): Promise<Channel | null> {
    return this.dataSource
      .getRepository(Channel)
      .findOneBy({ user_id: userId });
  }

  /**
   * Partial edit of the caller's channel. The nickname's uniqueness is decided
   * by the UNIQUE constraint (no check-then-write race): a violation becomes
   * NICKNAME_ALREADY_EXISTS and nothing changes.
   */
  async updateOwn(userId: string, dto: UpdateChannelDto): Promise<Channel> {
    if (
      dto.nickname === undefined &&
      dto.name === undefined &&
      dto.description === undefined
    ) {
      throw new BadRequestException(['at least one field must be sent']);
    }
    if (dto.nickname !== undefined && isReservedNickname(dto.nickname)) {
      throw new NicknameReservedException();
    }

    const repository = this.dataSource.getRepository(Channel);
    const channel = await repository.findOneBy({ user_id: userId });
    if (!channel) {
      throw new ChannelNotFoundException();
    }

    const changes: Partial<Pick<Channel, 'nickname' | 'name' | 'description'>> =
      {};
    if (dto.nickname !== undefined) changes.nickname = dto.nickname;
    if (dto.name !== undefined) changes.name = dto.name;
    if (dto.description !== undefined) changes.description = dto.description;

    try {
      await repository.update({ id: channel.id }, changes);
    } catch (err) {
      if (isPgUniqueViolationOnColumn(err, NICKNAME_COLUMN)) {
        throw new NicknameAlreadyExistsException();
      }
      throw err;
    }
    return repository.findOneByOrFail({ id: channel.id });
  }

  async createChannel(userId: string, email: string): Promise<Channel> {
    const baseNickname = sanitizeNickname(email.split('@')[0]);

    return this.dataSource.transaction(async (manager) => {
      let nickname = baseNickname;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const existing = await manager.findOne(Channel, {
          where: { nickname },
        });
        if (existing) {
          nickname = appendRandomSuffix(baseNickname);
          continue;
        }

        try {
          return await manager.save(
            manager.create(Channel, {
              name: baseNickname,
              nickname,
              user_id: userId,
            }),
          );
        } catch (err) {
          if (isPgUniqueViolationOnColumn(err, NICKNAME_COLUMN)) {
            // Concurrent insert between pre-check and save — retry with new suffix
            nickname = appendRandomSuffix(baseNickname);
          } else {
            throw err;
          }
        }
      }

      throw new Error(
        'Nickname conflict could not be resolved after max retries',
      );
    });
  }
}
