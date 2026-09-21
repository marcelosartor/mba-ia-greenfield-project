import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { S3Client } from '@aws-sdk/client-s3';
import type { ConfigType } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import videoConfig from '../config/video.config';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { VideoProcessingPublisher } from '../queue/video-processing.publisher';
import { StorageService } from '../storage/storage.service';
import { cleanAllTables } from '../test/create-test-data-source';
import { generateMp4 } from '../test/media-fixtures';
import {
  createStorageTestClient,
  deleteStoredObject,
} from '../test/storage-test-client';
import { waitFor } from '../test/wait-for';
import { User } from '../users/entities/user.entity';
import { Video } from '../videos/entities/video.entity';
import { VideoStatus } from '../videos/video-status.enum';
import { VideosRepository } from '../videos/videos.repository';
import { MediaProbeService } from './media/media-probe.service';
import { VideoProcessor } from './video.processor';
import { WorkerModule } from './worker.module';

jest.setTimeout(90000);

describe('VideoProcessor (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let videos: VideosRepository;
  let storage: StorageService;
  let publisher: VideoProcessingPublisher;
  let queue: Queue;
  let cleanupClient: S3Client;
  let channel: Channel;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();
    await module.init();
    dataSource = module.get(DataSource);
    videos = module.get(VideosRepository);
    storage = module.get(StorageService);
    publisher = module.get(VideoProcessingPublisher);
    queue = module.get<Queue>(getQueueToken(QUEUE_NAMES.VIDEO_PROCESSING));
    cleanupClient = createStorageTestClient();
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    cleanupClient.destroy();
    await module.close();
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await cleanAllTables(dataSource);
    const user = await dataSource
      .getRepository(User)
      .save({ email: 'worker@example.com', password: 'hashed' });
    channel = await dataSource
      .getRepository(Channel)
      .save({ name: 'Worker', nickname: 'worker', user_id: user.id });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    for (const video of await dataSource.getRepository(Video).find()) {
      await deleteStoredObject(
        cleanupClient,
        storage.videosBucket,
        video.video_key,
      );
      await deleteStoredObject(
        cleanupClient,
        storage.thumbnailsBucket,
        `${video.id}/default.jpg`,
      );
    }
  });

  /** A video whose upload is complete: the source object exists in the storage. */
  const createUploadedVideo = async (source: Buffer): Promise<Video> => {
    const draft = await videos.createDraft({
      channelId: channel.id,
      title: 'Holiday',
      extension: 'mp4',
    });
    await storage.putObject(
      storage.videosBucket,
      draft.video_key,
      source,
      'video/mp4',
    );
    await videos.markUploadCompleted(draft.id);
    return draft;
  };

  const statusOf = async (id: string): Promise<VideoStatus> =>
    (await dataSource.getRepository(Video).findOneByOrFail({ id })).status;

  const waitForStatus = (id: string, status: VideoStatus): Promise<true> =>
    waitFor(async () => (await statusOf(id)) === status || undefined);

  const jobState = async (id: string): Promise<string | false> => {
    const job = await queue.getJob(id);
    const state = job ? await job.getState() : 'unknown';
    return state === 'completed' ? state : false;
  };

  it('should process an uploaded video until it is ready, with metadata and thumbnail', async () => {
    const source = await generateMp4({ durationSeconds: 3 });
    const draft = await createUploadedVideo(source);

    await publisher.publish(draft.id);
    await waitForStatus(draft.id, VideoStatus.READY);

    const video = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: draft.id });
    expect(video.duration_seconds).toBeCloseTo(3, 0);
    expect(video).toMatchObject({
      width: 320,
      height: 240,
      video_codec: 'h264',
      audio_codec: 'aac',
      size_bytes: source.length,
      thumbnail_key: `${draft.id}/default.jpg`,
      error_code: null,
      error_message: null,
    });
    expect(video.format_name).toContain('mp4');
    expect(video.bit_rate).toBeGreaterThan(0);
    expect(video.metadata).toMatchObject({
      format: { nb_streams: 2 },
      streams: [{ codec_type: 'video' }, { codec_type: 'audio' }],
    });
    const thumbnail = await storage.headObject(
      storage.thumbnailsBucket,
      `${draft.id}/default.jpg`,
    );
    expect(thumbnail.contentType).toBe('image/jpeg');
    expect(thumbnail.contentLength).toBeGreaterThan(0);
  });

  it('should keep the video in processing while the job runs', async () => {
    const draft = await createUploadedVideo(await generateMp4());
    const probe = module.get<MediaProbeService>(MediaProbeService);
    const original = probe.probe.bind(probe) as MediaProbeService['probe'];
    const seenDuringRun: VideoStatus[] = [];
    jest.spyOn(probe, 'probe').mockImplementation(async (url, signal) => {
      seenDuringRun.push(await statusOf(draft.id));
      return original(url, signal);
    });

    await publisher.publish(draft.id);
    await waitForStatus(draft.id, VideoStatus.READY);

    expect(seenDuringRun).toEqual([VideoStatus.PROCESSING]);
  });

  it('should use the configured concurrency', () => {
    const config = module.get<ConfigType<typeof videoConfig>>(videoConfig.KEY);

    expect(module.get(VideoProcessor).worker.concurrency).toBe(
      config.workerConcurrency,
    );
  });

  it('should skip a video whose upload was not completed', async () => {
    const draft = await videos.createDraft({
      channelId: channel.id,
      title: 'Still uploading',
      extension: 'mp4',
    });

    await publisher.publish(draft.id);
    await waitFor(() => jobState(draft.id));

    expect(await statusOf(draft.id)).toBe(VideoStatus.DRAFT);
  });

  it('should finish without error a job whose video does not exist', async () => {
    const missingId = '00000000-0000-4000-8000-000000000000';

    await publisher.publish(missingId);

    await expect(waitFor(() => jobState(missingId))).resolves.toBe('completed');
  });
});
