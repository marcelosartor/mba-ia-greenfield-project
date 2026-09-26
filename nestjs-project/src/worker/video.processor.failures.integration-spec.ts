import { ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { UnrecoverableError, type Job, type Queue } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { JOB_NAMES, QUEUE_NAMES } from '../queue/queue.constants';
import type {
  DeadLetteredVideoJobData,
  VideoProcessingJobData,
} from '../queue/queue.types';
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
import { TransientMediaError } from './media/media.errors';
import { VideoProcessor } from './video.processor';
import { WorkerModule } from './worker.module';

jest.setTimeout(120000);

// Same policy as production (3 attempts, exponential backoff) with a short
// base delay so the retries do not slow the suite down.
const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 100 },
} as const;

describe('VideoProcessor failures (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let videos: VideosRepository;
  let storage: StorageService;
  let probe: MediaProbeService;
  let queue: Queue<VideoProcessingJobData>;
  let deadLetterQueue: Queue<DeadLetteredVideoJobData>;
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
    probe = module.get<MediaProbeService>(MediaProbeService);
    queue = module.get<Queue<VideoProcessingJobData>>(
      getQueueToken(QUEUE_NAMES.VIDEO_PROCESSING),
    );
    deadLetterQueue = module.get<Queue<DeadLetteredVideoJobData>>(
      getQueueToken(QUEUE_NAMES.VIDEO_PROCESSING_DLQ),
    );
    cleanupClient = createStorageTestClient();
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await deadLetterQueue.obliterate({ force: true });
    cleanupClient.destroy();
    await module.close();
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await deadLetterQueue.obliterate({ force: true });
    await cleanAllTables(dataSource);
    const user = await dataSource
      .getRepository(User)
      .save({ email: 'failures@example.com', password: 'hashed' });
    channel = await dataSource
      .getRepository(Channel)
      .save({ name: 'Failures', nickname: 'failures', user_id: user.id });
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

  const createUploadedVideo = async (source: Buffer): Promise<Video> => {
    const draft = await videos.createDraft({
      channelId: channel.id,
      title: 'Failing',
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

  const publish = (videoId: string): Promise<unknown> =>
    queue.add(
      JOB_NAMES.PROCESS_VIDEO,
      { videoId },
      {
        jobId: videoId,
        ...JOB_OPTIONS,
      },
    );

  const load = (id: string): Promise<Video> =>
    dataSource.getRepository(Video).findOneByOrFail({ id });

  const waitForStatus = (id: string, status: VideoStatus): Promise<Video> =>
    waitFor(async () => {
      const video = await load(id);
      return video.status === status ? video : undefined;
    });

  const waitForJob = (id: string, state: 'completed' | 'failed') =>
    waitFor(async () => {
      const job = await queue.getJob(id);
      return job && (await job.getState()) === state ? job : undefined;
    });

  it('should end a corrupted file in error after a single attempt', async () => {
    const draft = await createUploadedVideo(randomBytes(4096));

    await publish(draft.id);
    const video = await waitForStatus(draft.id, VideoStatus.ERROR);

    expect(video.error_code).toBe('INVALID_MEDIA');
    expect(video.error_message).toBeTruthy();
    expect(video.error_message).not.toContain('X-Amz-Signature');
    expect(video.thumbnail_key).toBeNull();
    const job = await waitForJob(draft.id, 'failed');
    expect(job.attemptsMade).toBe(1);
    expect(await deadLetterQueue.getJobCounts('waiting')).toEqual({
      waiting: 0,
    });
  });

  it('should finish ready when a transient failure hits only the first two attempts', async () => {
    const draft = await createUploadedVideo(await generateMp4());
    const original = probe.probe.bind(probe) as MediaProbeService['probe'];
    const spy = jest
      .spyOn(probe, 'probe')
      .mockRejectedValueOnce(new TransientMediaError('blip 1'))
      .mockRejectedValueOnce(new TransientMediaError('blip 2'))
      .mockImplementation((url, signal) => original(url, signal));

    await publish(draft.id);
    const video = await waitForStatus(draft.id, VideoStatus.READY);

    expect(spy).toHaveBeenCalledTimes(3);
    expect(video.thumbnail_key).toBe(`${draft.id}/default.jpg`);
    expect(video.error_code).toBeNull();
    await waitForJob(draft.id, 'completed');
    expect(await deadLetterQueue.getJobCounts('waiting')).toEqual({
      waiting: 0,
    });
  });

  it('should dead-letter a job that keeps failing and end the video in error', async () => {
    const draft = await createUploadedVideo(await generateMp4());
    const spy = jest
      .spyOn(probe, 'probe')
      .mockRejectedValue(new TransientMediaError('storage unreachable'));

    await publish(draft.id);
    const video = await waitForStatus(draft.id, VideoStatus.ERROR);

    expect(video.error_code).toBe('PROCESSING_FAILED');
    expect(video.error_message).toBe('storage unreachable');
    expect(spy).toHaveBeenCalledTimes(3);
    const dead = await waitFor(async () => {
      const [job] = await deadLetterQueue.getJobs(['waiting']);
      return job;
    });
    expect(dead.name).toBe('dead-lettered-video');
    expect(dead.data).toEqual({
      videoId: draft.id,
      failedReason: 'storage unreachable',
      attemptsMade: 3,
    });
  });

  it('should not reprocess a job delivered again for a video that is already ready', async () => {
    const draft = await createUploadedVideo(await generateMp4());
    await publish(draft.id);
    const ready = await waitForStatus(draft.id, VideoStatus.READY);
    await waitForJob(draft.id, 'completed');
    await queue.obliterate({ force: true });
    const spy = jest.spyOn(probe, 'probe');

    await publish(draft.id);
    await waitForJob(draft.id, 'completed');

    expect(spy).not.toHaveBeenCalled();
    const after = await load(draft.id);
    expect(after.thumbnail_key).toBe(ready.thumbnail_key);
    expect(after.updated_at).toEqual(ready.updated_at);
  });

  it('should finish ready when a job is delivered again while the video is processing, keeping one thumbnail', async () => {
    const draft = await createUploadedVideo(await generateMp4());
    await publish(draft.id);
    await waitForStatus(draft.id, VideoStatus.READY);
    await waitForJob(draft.id, 'completed');
    // the redelivery finds the video the way a crashed run left it
    await dataSource
      .getRepository(Video)
      .update({ id: draft.id }, { status: VideoStatus.PROCESSING });
    await queue.obliterate({ force: true });

    await publish(draft.id);
    await waitForStatus(draft.id, VideoStatus.READY);

    const listed = await cleanupClient.send(
      new ListObjectsV2Command({
        Bucket: storage.thumbnailsBucket,
        Prefix: `${draft.id}/`,
      }),
    );
    expect(listed.Contents?.map((object) => object.Key)).toEqual([
      `${draft.id}/default.jpg`,
    ]);
  });

  it('should end in error and dead-letter a video whose job stalled out of attempts', async () => {
    const draft = await createUploadedVideo(await generateMp4());
    // what a worker killed twice in the middle of the file leaves behind
    await videos.startProcessing(draft.id);
    const stalledJob = {
      data: { videoId: draft.id },
      attemptsMade: 1,
      opts: { attempts: 3 },
    } as unknown as Job;

    await module
      .get(VideoProcessor)
      .onFailed(
        stalledJob,
        new UnrecoverableError('job stalled more than allowable limit'),
      );

    const video = await load(draft.id);
    expect(video.status).toBe(VideoStatus.ERROR);
    expect(video.error_code).toBe('PROCESSING_FAILED');
    expect(video.error_message).toBe('job stalled more than allowable limit');
    const [dead] = await deadLetterQueue.getJobs(['waiting']);
    expect(dead.data).toEqual({
      videoId: draft.id,
      failedReason: 'job stalled more than allowable limit',
      attemptsMade: 1,
    });
  });
});
