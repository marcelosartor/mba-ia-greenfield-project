import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { QueryFailedError, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { Video } from './entities/video.entity';
import { generatePublicId } from './public-id.util';
import { VideoStatus } from './video-status.enum';

const PUBLIC_ID_UNIQUE_CONSTRAINT = 'UQ_videos_public_id';
const UNIQUE_VIOLATION = '23505';
const MAX_PUBLIC_ID_ATTEMPTS = 5;

export interface CreateDraftInput {
  channelId: string;
  title: string;
  extension: string;
}

@Injectable()
export class VideosRepository {
  constructor(
    @InjectRepository(Video)
    private readonly repository: Repository<Video>,
  ) {}

  /**
   * Inserts a draft with a fresh public_id. The unique constraint is the
   * arbiter under concurrency: on a public_id collision the insert is retried
   * with a new value. Must not run inside a caller's transaction, because a
   * constraint violation aborts the whole transaction in PostgreSQL.
   */
  async createDraft(input: CreateDraftInput): Promise<Video> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_PUBLIC_ID_ATTEMPTS; attempt++) {
      const id = randomUUID();
      try {
        return await this.repository.save(
          this.repository.create({
            id,
            public_id: generatePublicId(),
            channel_id: input.channelId,
            title: input.title,
            status: VideoStatus.DRAFT,
            video_key: `${input.channelId}/${id}/source.${input.extension}`,
          }),
        );
      } catch (error) {
        if (!this.isPublicIdCollision(error)) {
          throw error;
        }
        lastError = error;
      }
    }

    throw lastError;
  }

  async findByPublicId(publicId: string): Promise<Video | null> {
    return this.repository.findOneBy({ public_id: publicId });
  }

  /**
   * Compare-and-set: moves the video to `to` only if it is currently in one of
   * the `from` statuses. Returns whether a row was updated, so an invalid
   * transition (0 rows) is a plain `false`, never an error.
   */
  async transitionStatus(
    videoId: string,
    from: VideoStatus | VideoStatus[],
    to: VideoStatus,
    changes: QueryDeepPartialEntity<Video> = {},
  ): Promise<boolean> {
    const expected = Array.isArray(from) ? from : [from];
    const result = await this.repository
      .createQueryBuilder()
      .update(Video)
      .set({ ...changes, status: to })
      .where('id = :videoId', { videoId })
      .andWhere('status IN (:...expected)', { expected })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  private isPublicIdCollision(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }
    const driverError = error.driverError as {
      code?: string;
      constraint?: string;
    };
    return (
      driverError.code === UNIQUE_VIOLATION &&
      driverError.constraint === PUBLIC_ID_UNIQUE_CONSTRAINT
    );
  }
}
