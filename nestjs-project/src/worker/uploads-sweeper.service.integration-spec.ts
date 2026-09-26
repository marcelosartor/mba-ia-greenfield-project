import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { StorageService } from '../storage/storage.service';
import { cleanAllTables } from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from '../videos/entities/video.entity';
import { VideoStatus } from '../videos/video-status.enum';
import { VideosRepository } from '../videos/videos.repository';
import { UploadsSweeperProcessor } from './uploads-sweeper.processor';
import { UploadsSweeperService } from './uploads-sweeper.service';
import { VideoProcessor } from './video.processor';
import { WorkerModule } from './worker.module';

jest.setTimeout(60000);

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

describe('UploadsSweeperService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let videos: VideosRepository;
  let storage: StorageService;
  let sweeper: UploadsSweeperService;
  let queue: Queue;
  let channel: Channel;
  const openUploads: { key: string; uploadId: string }[] = [];

  beforeAll(async () => {
    // No consumer starts: the jobs the sweeper publishes must stay in the queue.
    module = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(VideoProcessor)
      .useValue({})
      .overrideProvider(UploadsSweeperProcessor)
      .useValue({})
      .compile();
    dataSource = module.get(DataSource);
    videos = module.get(VideosRepository);
    storage = module.get(StorageService);
    sweeper = module.get(UploadsSweeperService);
    queue = module.get<Queue>(getQueueToken(QUEUE_NAMES.VIDEO_PROCESSING));
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await module.close();
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await cleanAllTables(dataSource);
    const user = await dataSource
      .getRepository(User)
      .save({ email: 'sweeper@example.com', password: 'hashed' });
    channel = await dataSource
      .getRepository(Channel)
      .save({ name: 'Sweeper', nickname: 'sweeper', user_id: user.id });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    for (const { key, uploadId } of openUploads.splice(0)) {
      await storage.abortMultipartUpload(key, uploadId).catch(() => undefined);
    }
  });

  /** A draft with a real open multipart upload. */
  const createDraftWithUpload = async (): Promise<Video> => {
    const draft = await videos.createDraft({
      channelId: channel.id,
      title: 'Sweep me',
      extension: 'mp4',
    });
    const uploadId = await storage.createMultipartUpload(
      draft.video_key,
      'video/mp4',
    );
    await videos.setUploadId(draft.id, uploadId);
    openUploads.push({ key: draft.video_key, uploadId });
    return { ...draft, upload_id: uploadId };
  };

  const ago = (ms: number): Date => new Date(Date.now() - ms);

  const backdate = (
    id: string,
    column: 'created_at' | 'upload_completed_at' | 'updated_at',
    when: Date,
  ): Promise<unknown> =>
    dataSource.query(`UPDATE "videos" SET "${column}" = $1 WHERE "id" = $2`, [
      when,
      id,
    ]);

  const multipartExists = (video: Video): Promise<boolean> =>
    storage
      .listParts(video.video_key, video.upload_id as string)
      .then(() => true)
      .catch((error: { name?: string }) => {
        if (error.name === 'NoSuchUpload') return false;
        throw error;
      });

  const jobIds = async (): Promise<string[]> =>
    (await queue.getJobs(['waiting', 'delayed', 'active'])).map(
      (job) => job.id as string,
    );

  describe('abandoned uploads', () => {
    it('should abort the multipart and remove a draft abandoned for over 24 hours', async () => {
      const draft = await createDraftWithUpload();
      await backdate(draft.id, 'created_at', ago(25 * HOUR_MS));

      const result = await sweeper.run();

      expect(result.abandonedRemoved).toBe(1);
      expect(
        await dataSource.getRepository(Video).countBy({ id: draft.id }),
      ).toBe(0);
      expect(await multipartExists(draft)).toBe(false);
    });

    it('should leave a draft created one hour ago untouched', async () => {
      const draft = await createDraftWithUpload();
      await backdate(draft.id, 'created_at', ago(HOUR_MS));

      const result = await sweeper.run();

      expect(result.abandonedRemoved).toBe(0);
      expect(
        await dataSource.getRepository(Video).countBy({ id: draft.id }),
      ).toBe(1);
      expect(await multipartExists(draft)).toBe(true);
    });

    it('should remove a draft whose multipart no longer exists', async () => {
      const draft = await createDraftWithUpload();
      await storage.abortMultipartUpload(
        draft.video_key,
        draft.upload_id as string,
      );
      await backdate(draft.id, 'created_at', ago(25 * HOUR_MS));

      const result = await sweeper.run();

      expect(result.abandonedRemoved).toBe(1);
    });

    it('should keep the row when the storage cannot abort, and retry on the next run', async () => {
      const draft = await createDraftWithUpload();
      await backdate(draft.id, 'created_at', ago(25 * HOUR_MS));
      jest
        .spyOn(storage, 'abortMultipartUpload')
        .mockRejectedValueOnce(new Error('storage down'));

      const failed = await sweeper.run();
      expect(failed.abandonedRemoved).toBe(0);
      expect(
        await dataSource.getRepository(Video).countBy({ id: draft.id }),
      ).toBe(1);

      const retried = await sweeper.run();
      expect(retried.abandonedRemoved).toBe(1);
    });

    it('should not remove a video whose upload was completed', async () => {
      const draft = await createDraftWithUpload();
      await videos.markUploadCompleted(draft.id);
      await backdate(draft.id, 'created_at', ago(48 * HOUR_MS));

      await sweeper.run();

      expect(
        await dataSource.getRepository(Video).countBy({ id: draft.id }),
      ).toBe(1);
    });

    it('should not remove a video that already left draft', async () => {
      const draft = await createDraftWithUpload();
      await dataSource
        .getRepository(Video)
        .update({ id: draft.id }, { status: VideoStatus.ERROR });
      await backdate(draft.id, 'created_at', ago(48 * HOUR_MS));

      await sweeper.run();

      expect(
        await dataSource.getRepository(Video).countBy({ id: draft.id }),
      ).toBe(1);
    });
  });

  describe('completed uploads awaiting the worker', () => {
    const completedDraft = async (completedAgoMs: number): Promise<Video> => {
      const draft = await videos.createDraft({
        channelId: channel.id,
        title: 'Completed',
        extension: 'mp4',
      });
      await videos.markUploadCompleted(draft.id);
      await backdate(draft.id, 'upload_completed_at', ago(completedAgoMs));
      return draft;
    };

    it('should publish the job of a draft completed over five minutes ago', async () => {
      const draft = await completedDraft(10 * MINUTE_MS);

      const result = await sweeper.run();

      expect(result.jobsRepublished).toBe(1);
      const job = await queue.getJob(draft.id);
      expect(job?.id).toBe(draft.id);
      expect(job?.data).toEqual({ videoId: draft.id });
    });

    it('should not duplicate the job when the sweeper runs twice', async () => {
      const draft = await completedDraft(10 * MINUTE_MS);

      await sweeper.run();
      await sweeper.run();

      expect(await jobIds()).toEqual([draft.id]);
    });

    it('should leave alone an upload completed a minute ago', async () => {
      await completedDraft(MINUTE_MS);

      const result = await sweeper.run();

      expect(result.jobsRepublished).toBe(0);
      expect(await jobIds()).toEqual([]);
    });

    it('should not publish for a video that already left draft', async () => {
      const draft = await completedDraft(10 * MINUTE_MS);
      await dataSource
        .getRepository(Video)
        .update({ id: draft.id }, { status: VideoStatus.READY });

      await sweeper.run();

      expect(await jobIds()).toEqual([]);
    });
  });

  describe('videos stuck in processing', () => {
    const stuckVideo = async (updatedAgoMs: number): Promise<Video> => {
      const draft = await videos.createDraft({
        channelId: channel.id,
        title: 'Stuck',
        extension: 'mp4',
      });
      await videos.markUploadCompleted(draft.id);
      await videos.startProcessing(draft.id);
      await backdate(draft.id, 'updated_at', ago(updatedAgoMs));
      return draft;
    };

    it('should queue again a video left in processing with no job at all', async () => {
      const draft = await stuckVideo(3 * HOUR_MS);

      const result = await sweeper.run();

      expect(result.stuckRepublished).toBe(1);
      expect((await queue.getJob(draft.id))?.data).toEqual({
        videoId: draft.id,
      });
    });

    it('should leave alone a video processed a few minutes ago', async () => {
      await stuckVideo(10 * MINUTE_MS);

      const result = await sweeper.run();

      expect(result.stuckRepublished).toBe(0);
      expect(await jobIds()).toEqual([]);
    });

    it('should not touch a stuck video whose job is still waiting or running', async () => {
      const draft = await stuckVideo(3 * HOUR_MS);
      await queue.add(
        'process-video',
        { videoId: draft.id },
        { jobId: draft.id },
      );

      await sweeper.run();
      await sweeper.run();

      expect(await jobIds()).toEqual([draft.id]);
    });
  });

  it('should keep sweeping the other videos when one fails', async () => {
    const first = await createDraftWithUpload();
    const second = await createDraftWithUpload();
    await backdate(first.id, 'created_at', ago(26 * HOUR_MS));
    await backdate(second.id, 'created_at', ago(25 * HOUR_MS));
    jest
      .spyOn(storage, 'abortMultipartUpload')
      .mockRejectedValueOnce(new Error('storage down'));

    const result = await sweeper.run();

    expect(result.abandonedRemoved).toBe(1);
    expect(
      await dataSource.getRepository(Video).countBy({ id: first.id }),
    ).toBe(1);
    expect(
      await dataSource.getRepository(Video).countBy({ id: second.id }),
    ).toBe(0);
  });
});
