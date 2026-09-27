import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Category } from '../../categories/entities/category.entity';
import { Channel } from '../../channels/entities/channel.entity';
import { VIDEO_STATUS_VALUES, VideoStatus } from '../video-status.enum';
import {
  VIDEO_VISIBILITY_VALUES,
  VideoVisibility,
} from '../video-visibility.enum';

// PostgreSQL returns numeric and bigint columns as strings; the values stored
// here (durations, bit rates, sizes up to 10 GiB) fit safely in a JS number.
const nullableNumberTransformer = {
  to: (value: number | null | undefined): number | null | undefined => value,
  from: (value: string | null): number | null =>
    value === null ? null : Number(value),
};

const STATUS_CHECK = `"status" IN (${VIDEO_STATUS_VALUES.map((status) => `'${status}'`).join(', ')})`;
const VISIBILITY_CHECK = `"visibility" IN (${VIDEO_VISIBILITY_VALUES.map((visibility) => `'${visibility}'`).join(', ')})`;
// Only a processed video can be published (Phase 04, TD-01).
const PUBLISHED_READY_CHECK = `"published_at" IS NULL OR "status" = '${VideoStatus.READY}'`;

@Entity('videos')
@Unique('UQ_videos_public_id', ['public_id'])
@Index('IDX_videos_status_created_at', ['status', 'created_at'])
@Check('CHK_videos_status', STATUS_CHECK)
@Check('CHK_videos_visibility', VISIBILITY_CHECK)
@Check('CHK_videos_published_ready', PUBLISHED_READY_CHECK)
// Owner panel: every video of a channel, newest first.
@Index('IDX_videos_channel_created', ['channel_id', 'created_at', 'id'])
// Public channel page and video_count: listable videos only (partial index).
@Index('IDX_videos_channel_listable', ['channel_id', 'published_at', 'id'], {
  where: `"published_at" IS NOT NULL AND "visibility" = '${VideoVisibility.PUBLIC}'`,
})
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 11 })
  public_id: string;

  @Index('IDX_videos_channel_id')
  @Column({ type: 'uuid' })
  channel_id: string;

  @Column({ type: 'varchar', length: 100 })
  title: string;

  @Column({ type: 'varchar', length: 5000, nullable: true })
  description: string | null;

  @Column({ type: 'uuid', nullable: true })
  category_id: string | null;

  @Column({ type: 'varchar', length: 16, default: VideoVisibility.PUBLIC })
  visibility: VideoVisibility;

  /** Null while the video is an editorial draft. */
  @Column({ type: 'timestamp', nullable: true })
  published_at: Date | null;

  @Column({ type: 'varchar', length: 16, default: VideoStatus.DRAFT })
  status: VideoStatus;

  @Column({ type: 'varchar', length: 1024 })
  video_key: string;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  thumbnail_key: string | null;

  /** Owner-uploaded cover, `{videoId}/custom.jpg`; never written by the worker. */
  @Column({ type: 'varchar', length: 1024, nullable: true })
  custom_thumbnail_key: string | null;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  upload_id: string | null;

  // Size the client declared when starting the upload. It bounds the part
  // numbers and fixes the length signed into each presigned part URL. Null only
  // for drafts created before the column existed.
  @Column({
    type: 'bigint',
    nullable: true,
    transformer: nullableNumberTransformer,
  })
  declared_size_bytes: number | null;

  @Column({ type: 'timestamp', nullable: true })
  upload_completed_at: Date | null;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 3,
    nullable: true,
    transformer: nullableNumberTransformer,
  })
  duration_seconds: number | null;

  @Column({ type: 'integer', nullable: true })
  width: number | null;

  @Column({ type: 'integer', nullable: true })
  height: number | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  video_codec: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  audio_codec: string | null;

  @Column({
    type: 'bigint',
    nullable: true,
    transformer: nullableNumberTransformer,
  })
  bit_rate: number | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  format_name: string | null;

  @Column({
    type: 'bigint',
    nullable: true,
    transformer: nullableNumberTransformer,
  })
  size_bytes: number | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  error_code: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  error_message: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => Channel, (channel) => channel.videos)
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;

  @ManyToOne(() => Category, { nullable: true })
  @JoinColumn({ name: 'category_id' })
  category: Category | null;
}
