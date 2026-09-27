import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import {
  IsNull,
  LessThan,
  QueryFailedError,
  Repository,
  type SelectQueryBuilder,
} from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { Video } from './entities/video.entity';
import { generatePublicId } from './public-id.util';
import { VideoStatus } from './video-status.enum';
import { VideoVisibility } from './video-visibility.enum';

const PUBLIC_ID_UNIQUE_CONSTRAINT = 'UQ_videos_public_id';
const UNIQUE_VIOLATION = '23505';
const MAX_PUBLIC_ID_ATTEMPTS = 5;

/** Columns the owner may edit; everything else is written by the system. */
export interface EditableVideoFields {
  title?: string;
  description?: string | null;
  category_id?: string | null;
  visibility?: VideoVisibility;
}

const EDITABLE_COLUMNS: readonly (keyof EditableVideoFields)[] = [
  'title',
  'description',
  'category_id',
  'visibility',
];

/**
 * The single definition of a listable video (Phase 04, TD-01): published and
 * public. Reused by the public channel page and, later, by Phases 05 and 07.
 * Being published implies `ready` (CHK_videos_published_ready).
 */
export function whereListable<T extends object>(
  query: SelectQueryBuilder<T>,
  alias: string,
): SelectQueryBuilder<T> {
  return query
    .andWhere(`${alias}.published_at IS NOT NULL`)
    .andWhere(`${alias}.visibility = :listableVisibility`, {
      listableVisibility: VideoVisibility.PUBLIC,
    });
}

export interface CreateDraftInput {
  channelId: string;
  title: string;
  extension: string;
  declaredSizeBytes: number;
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
            declared_size_bytes: input.declaredSizeBytes,
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

  /** Loads the video with its channel (owner check) and category. */
  async findByPublicIdWithRelations(publicId: string): Promise<Video | null> {
    return this.repository.findOne({
      where: { public_id: publicId },
      relations: { channel: true, category: true },
    });
  }

  /**
   * Writes only the owner-editable columns, ignoring any other key, so an
   * edit never touches what the worker writes (status, keys, metadata).
   */
  async updateEditableFields(
    videoId: string,
    changes: EditableVideoFields,
  ): Promise<void> {
    const allowed: QueryDeepPartialEntity<Video> = {};
    for (const column of EDITABLE_COLUMNS) {
      if (changes[column] !== undefined) {
        (allowed as Record<string, unknown>)[column] = changes[column];
      }
    }
    if (Object.keys(allowed).length === 0) return;
    await this.repository.update({ id: videoId }, allowed);
  }

  /**
   * Publishes only a `ready` video, writing `published_at = now()` on every
   * call. Returns false when the video is not `ready` (nothing written).
   */
  async publish(
    videoId: string,
    visibility: VideoVisibility,
  ): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(Video)
      .set({ published_at: () => 'now()', visibility })
      .where('id = :videoId', { videoId })
      .andWhere('status = :ready', { ready: VideoStatus.READY })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  /** Back to editorial draft; the visibility is kept. */
  async unpublish(videoId: string): Promise<void> {
    await this.repository.update({ id: videoId }, { published_at: null });
  }

  async setCustomThumbnailKey(
    videoId: string,
    key: string | null,
  ): Promise<void> {
    await this.repository.update(
      { id: videoId },
      { custom_thumbnail_key: key },
    );
  }

  /**
   * One page of the owner's panel: every status, newest first, with the
   * category joined. `offset`/`limit` instead of `skip`/`take` keeps it to one
   * SELECT (the many-to-one join does not multiply rows) plus one COUNT.
   */
  async findPanelPage(
    channelId: string,
    page: number,
    limit: number,
  ): Promise<[Video[], number]> {
    return this.repository
      .createQueryBuilder('video')
      .leftJoinAndSelect('video.category', 'category')
      .where('video.channel_id = :channelId', { channelId })
      .orderBy('video.created_at', 'DESC')
      .addOrderBy('video.id', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getManyAndCount();
  }

  /** One page of the public channel page: listable only, newest first. */
  async findListablePage(
    channelId: string,
    page: number,
    limit: number,
  ): Promise<[Video[], number]> {
    return whereListable(
      this.repository
        .createQueryBuilder('video')
        .where('video.channel_id = :channelId', { channelId }),
      'video',
    )
      .orderBy('video.published_at', 'DESC')
      .addOrderBy('video.id', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getManyAndCount();
  }

  /** `video_count` of the public channel page (same predicate as the list). */
  async countListable(channelId: string): Promise<number> {
    return whereListable(
      this.repository
        .createQueryBuilder('video')
        .where('video.channel_id = :channelId', { channelId }),
      'video',
    ).getCount();
  }

  async findById(videoId: string): Promise<Video | null> {
    return this.repository.findOneBy({ id: videoId });
  }

  async setUploadId(videoId: string, uploadId: string): Promise<void> {
    await this.repository.update({ id: videoId }, { upload_id: uploadId });
  }

  /**
   * Single UPDATE that records the completion and clears the multipart id.
   * Returns false when another request completed the upload first.
   */
  async markUploadCompleted(videoId: string): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(Video)
      .set({ upload_completed_at: () => 'now()', upload_id: null })
      .where('id = :videoId', { videoId })
      .andWhere('upload_completed_at IS NULL')
      .execute();

    return (result.affected ?? 0) > 0;
  }

  async deleteById(videoId: string): Promise<void> {
    await this.repository.delete({ id: videoId });
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

  /**
   * Worker entry: `draft` -> `processing` (or `processing` -> `processing` when
   * a retry or redelivery re-enters), only once the upload was completed.
   * Returns false when the video is missing, already `ready`/`error`, or its
   * upload is not complete.
   */
  async startProcessing(videoId: string): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(Video)
      .set({ status: VideoStatus.PROCESSING })
      .where('id = :videoId', { videoId })
      .andWhere('status IN (:...expected)', {
        expected: [VideoStatus.DRAFT, VideoStatus.PROCESSING],
      })
      .andWhere('upload_completed_at IS NOT NULL')
      .execute();

    return (result.affected ?? 0) > 0;
  }

  /** Drafts whose upload was never completed and are older than `before`. */
  async findAbandonedDrafts(before: Date, limit: number): Promise<Video[]> {
    return this.repository.find({
      where: {
        status: VideoStatus.DRAFT,
        upload_completed_at: IsNull(),
        created_at: LessThan(before),
      },
      order: { created_at: 'ASC' },
      take: limit,
    });
  }

  /** Drafts whose upload completed before `before` but never left `draft`. */
  async findCompletedAwaitingWorker(
    before: Date,
    limit: number,
  ): Promise<Video[]> {
    return this.repository.find({
      where: {
        status: VideoStatus.DRAFT,
        upload_completed_at: LessThan(before),
      },
      order: { created_at: 'ASC' },
      take: limit,
    });
  }

  /** Videos in `processing` that nothing has touched since before `before`. */
  async findStuckProcessing(before: Date, limit: number): Promise<Video[]> {
    return this.repository.find({
      where: { status: VideoStatus.PROCESSING, updated_at: LessThan(before) },
      order: { updated_at: 'ASC' },
      take: limit,
    });
  }

  /**
   * Deletes a draft only while its upload is still incomplete, so a completion
   * that raced with the sweeper is never lost. Returns whether a row was
   * deleted.
   */
  async deleteAbandonedDraft(videoId: string): Promise<boolean> {
    const result = await this.repository.delete({
      id: videoId,
      status: VideoStatus.DRAFT,
      upload_completed_at: IsNull(),
    });

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
