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
import { Channel } from '../../channels/entities/channel.entity';
import { VIDEO_STATUS_VALUES, VideoStatus } from '../video-status.enum';

// PostgreSQL returns numeric and bigint columns as strings; the values stored
// here (durations, bit rates, sizes up to 10 GiB) fit safely in a JS number.
const nullableNumberTransformer = {
  to: (value: number | null | undefined): number | null | undefined => value,
  from: (value: string | null): number | null =>
    value === null ? null : Number(value),
};

const STATUS_CHECK = `"status" IN (${VIDEO_STATUS_VALUES.map((status) => `'${status}'`).join(', ')})`;

@Entity('videos')
@Unique('UQ_videos_public_id', ['public_id'])
@Index('IDX_videos_status_created_at', ['status', 'created_at'])
@Check('CHK_videos_status', STATUS_CHECK)
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

  @Column({ type: 'varchar', length: 16, default: VideoStatus.DRAFT })
  status: VideoStatus;

  @Column({ type: 'varchar', length: 1024 })
  video_key: string;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  thumbnail_key: string | null;

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
}
