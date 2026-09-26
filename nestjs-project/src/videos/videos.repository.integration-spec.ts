import { Test } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import * as publicIdUtil from './public-id.util';
import { VideoStatus } from './video-status.enum';
import { VideosRepository } from './videos.repository';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('VideosRepository (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let repository: VideosRepository;
  let closeModule: () => Promise<void>;
  let channel: Channel;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        TypeOrmModule.forFeature([Video]),
      ],
      providers: [VideosRepository],
    }).compile();

    dataSource = module.get(DataSource);
    videoRepository = module.get(getRepositoryToken(Video));
    repository = module.get(VideosRepository);
    closeModule = () => module.close();
  });

  afterAll(async () => {
    await closeModule();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    const user = await dataSource
      .getRepository(User)
      .save({ email: 'repo_owner@example.com', password: 'hashed' });
    channel = await dataSource.getRepository(Channel).save({
      name: 'Repo Owner',
      nickname: 'repoowner',
      user_id: user.id,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const createDraft = (title = 'A video'): Promise<Video> =>
    repository.createDraft({
      channelId: channel.id,
      title,
      extension: 'mp4',
      declaredSizeBytes: 1_000,
    });

  describe('createDraft', () => {
    it('should insert a draft with a public_id and a key under the channel', async () => {
      const draft = await createDraft('First');

      expect(draft.status).toBe(VideoStatus.DRAFT);
      expect(draft.public_id).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(draft.video_key).toBe(`${channel.id}/${draft.id}/source.mp4`);
      expect(await videoRepository.countBy({ id: draft.id })).toBe(1);
    });

    it('should create fifty concurrent drafts with distinct public_ids', async () => {
      const drafts = await Promise.all(
        Array.from({ length: 50 }, (_, i) => createDraft(`Video ${i}`)),
      );

      expect(new Set(drafts.map((d) => d.public_id)).size).toBe(50);
      expect(await videoRepository.count()).toBe(50);
    });

    it('should retry with a new public_id when the generated one collides', async () => {
      await videoRepository.save({
        public_id: 'collision-1',
        channel_id: channel.id,
        title: 'Existing',
        video_key: 'x/y/source.mp4',
      });
      const generate = jest
        .spyOn(publicIdUtil, 'generatePublicId')
        .mockReturnValueOnce('collision-1')
        .mockReturnValueOnce('collision-1')
        .mockReturnValueOnce('fresh-id-01');

      const draft = await createDraft();

      expect(draft.public_id).toBe('fresh-id-01');
      expect(generate).toHaveBeenCalledTimes(3);
    });

    it('should give up after repeated collisions', async () => {
      await videoRepository.save({
        public_id: 'collision-1',
        channel_id: channel.id,
        title: 'Existing',
        video_key: 'x/y/source.mp4',
      });
      jest
        .spyOn(publicIdUtil, 'generatePublicId')
        .mockReturnValue('collision-1');

      await expect(createDraft()).rejects.toMatchObject({
        driverError: { constraint: 'UQ_videos_public_id' },
      });
    });

    it('should not swallow errors that are not a public_id collision', async () => {
      await expect(
        repository.createDraft({
          channelId: '00000000-0000-4000-8000-000000000000',
          title: 'Orphan',
          extension: 'mp4',
          declaredSizeBytes: 1_000,
        }),
      ).rejects.toMatchObject({ driverError: { code: '23503' } });
    });
  });

  describe('findByPublicId', () => {
    it('should return the video or null', async () => {
      const draft = await createDraft();

      expect((await repository.findByPublicId(draft.public_id))?.id).toBe(
        draft.id,
      );
      expect(await repository.findByPublicId('does-not-ex')).toBeNull();
    });
  });

  describe('transitionStatus', () => {
    it('should move the video when it is in the expected status', async () => {
      const draft = await createDraft();

      const moved = await repository.transitionStatus(
        draft.id,
        VideoStatus.DRAFT,
        VideoStatus.PROCESSING,
        { upload_completed_at: new Date() },
      );

      expect(moved).toBe(true);
      const found = await videoRepository.findOneByOrFail({ id: draft.id });
      expect(found.status).toBe(VideoStatus.PROCESSING);
      expect(found.upload_completed_at).toBeInstanceOf(Date);
    });

    it('should accept any of several expected statuses', async () => {
      const draft = await createDraft();
      await repository.transitionStatus(
        draft.id,
        VideoStatus.DRAFT,
        VideoStatus.ERROR,
      );

      const moved = await repository.transitionStatus(
        draft.id,
        [VideoStatus.PROCESSING, VideoStatus.ERROR],
        VideoStatus.PROCESSING,
      );

      expect(moved).toBe(true);
    });

    it('should not change anything when the video is already ready', async () => {
      const draft = await createDraft();
      await repository.transitionStatus(
        draft.id,
        VideoStatus.DRAFT,
        VideoStatus.READY,
        { duration_seconds: 10 },
      );

      const moved = await repository.transitionStatus(
        draft.id,
        VideoStatus.PROCESSING,
        VideoStatus.READY,
        { duration_seconds: 99 },
      );

      expect(moved).toBe(false);
      const found = await videoRepository.findOneByOrFail({ id: draft.id });
      expect(found.status).toBe(VideoStatus.READY);
      expect(found.duration_seconds).toBe(10);
    });

    it('should let only one of two concurrent transitions win', async () => {
      const draft = await createDraft();

      const results = await Promise.all([
        repository.transitionStatus(
          draft.id,
          VideoStatus.DRAFT,
          VideoStatus.PROCESSING,
        ),
        repository.transitionStatus(
          draft.id,
          VideoStatus.DRAFT,
          VideoStatus.PROCESSING,
        ),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
    });
  });

  describe('markUploadCompleted', () => {
    it('should record the completion and clear the multipart id in one update', async () => {
      const draft = await createDraft();
      await repository.setUploadId(draft.id, 'upload-1');

      const marked = await repository.markUploadCompleted(draft.id);

      expect(marked).toBe(true);
      const found = await videoRepository.findOneByOrFail({ id: draft.id });
      expect(found.upload_completed_at).toBeInstanceOf(Date);
      expect(found.upload_id).toBeNull();
      expect(found.status).toBe(VideoStatus.DRAFT);
    });

    it('should not touch a video whose upload was already completed', async () => {
      const draft = await createDraft();
      await repository.markUploadCompleted(draft.id);
      const firstCompletion = (
        await videoRepository.findOneByOrFail({ id: draft.id })
      ).upload_completed_at;

      const marked = await repository.markUploadCompleted(draft.id);

      expect(marked).toBe(false);
      const found = await videoRepository.findOneByOrFail({ id: draft.id });
      expect(found.upload_completed_at).toEqual(firstCompletion);
    });

    it('should let only one of two concurrent completions win', async () => {
      const draft = await createDraft();

      const results = await Promise.all([
        repository.markUploadCompleted(draft.id),
        repository.markUploadCompleted(draft.id),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
    });
  });

  describe('setUploadId and deleteById', () => {
    it('should store the upload id and delete the video', async () => {
      const draft = await createDraft();

      await repository.setUploadId(draft.id, 'upload-9');
      expect(
        (await videoRepository.findOneByOrFail({ id: draft.id })).upload_id,
      ).toBe('upload-9');

      await repository.deleteById(draft.id);
      expect(await videoRepository.countBy({ id: draft.id })).toBe(0);
    });
  });

  describe('findById', () => {
    it('should return the video or null', async () => {
      const draft = await createDraft();

      expect((await repository.findById(draft.id))?.public_id).toBe(
        draft.public_id,
      );
      expect(
        await repository.findById('00000000-0000-4000-8000-000000000000'),
      ).toBeNull();
    });
  });

  describe('startProcessing', () => {
    it('should move a draft with a completed upload to processing', async () => {
      const draft = await createDraft();
      await repository.markUploadCompleted(draft.id);

      expect(await repository.startProcessing(draft.id)).toBe(true);
      expect((await repository.findById(draft.id))?.status).toBe(
        VideoStatus.PROCESSING,
      );
    });

    it('should accept the reentry of a video already in processing', async () => {
      const draft = await createDraft();
      await repository.markUploadCompleted(draft.id);
      await repository.startProcessing(draft.id);

      expect(await repository.startProcessing(draft.id)).toBe(true);
    });

    it('should refuse a draft whose upload is not completed', async () => {
      const draft = await createDraft();

      expect(await repository.startProcessing(draft.id)).toBe(false);
      expect((await repository.findById(draft.id))?.status).toBe(
        VideoStatus.DRAFT,
      );
    });

    it.each([VideoStatus.READY, VideoStatus.ERROR])(
      'should not touch a video that is already %s',
      async (status) => {
        const draft = await createDraft();
        await repository.markUploadCompleted(draft.id);
        await videoRepository.update({ id: draft.id }, { status });

        expect(await repository.startProcessing(draft.id)).toBe(false);
        expect((await repository.findById(draft.id))?.status).toBe(status);
      },
    );
  });

  describe('sweeper queries', () => {
    const backdate = (
      id: string,
      column: 'created_at' | 'upload_completed_at',
      when: Date,
    ): Promise<unknown> =>
      dataSource.query(`UPDATE "videos" SET "${column}" = $1 WHERE "id" = $2`, [
        when,
        id,
      ]);
    const daysAgo = (days: number): Date =>
      new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    it('should find only old drafts whose upload was never completed', async () => {
      const abandoned = await createDraft('abandoned');
      await createDraft('recent'); // created now: not abandoned
      const completed = await createDraft('completed');
      const notDraft = await createDraft('not draft');
      await repository.markUploadCompleted(completed.id);
      await videoRepository.update(
        { id: notDraft.id },
        { status: VideoStatus.ERROR },
      );
      for (const video of [abandoned, completed, notDraft]) {
        await backdate(video.id, 'created_at', daysAgo(2));
      }

      const found = await repository.findAbandonedDrafts(daysAgo(1), 10);

      expect(found.map((video) => video.id)).toEqual([abandoned.id]);
    });

    it('should find drafts whose upload completed before the limit', async () => {
      const waiting = await createDraft('waiting');
      const fresh = await createDraft('fresh'); // completed now: inside the grace
      await createDraft('incomplete'); // no completed upload
      const ready = await createDraft('ready');
      await repository.markUploadCompleted(waiting.id);
      await repository.markUploadCompleted(fresh.id);
      await repository.markUploadCompleted(ready.id);
      await videoRepository.update(
        { id: ready.id },
        { status: VideoStatus.READY },
      );
      for (const video of [waiting, ready]) {
        await backdate(video.id, 'upload_completed_at', daysAgo(1));
      }

      const found = await repository.findCompletedAwaitingWorker(
        daysAgo(0.5),
        10,
      );

      expect(found.map((video) => video.id)).toEqual([waiting.id]);
    });

    it('should respect the batch limit, oldest first', async () => {
      const older = await createDraft('older');
      const newer = await createDraft('newer');
      await backdate(older.id, 'created_at', daysAgo(3));
      await backdate(newer.id, 'created_at', daysAgo(2));

      const found = await repository.findAbandonedDrafts(daysAgo(1), 1);

      expect(found.map((video) => video.id)).toEqual([older.id]);
    });

    it('should delete an abandoned draft only while its upload is incomplete', async () => {
      const abandoned = await createDraft('abandoned');
      const completed = await createDraft('completed');
      await repository.markUploadCompleted(completed.id);

      expect(await repository.deleteAbandonedDraft(abandoned.id)).toBe(true);
      expect(await repository.deleteAbandonedDraft(completed.id)).toBe(false);
      expect(await repository.deleteAbandonedDraft(abandoned.id)).toBe(false);
      expect(await videoRepository.countBy({ id: completed.id })).toBe(1);
    });
  });

  describe('stuck processing', () => {
    const hoursAgo = (hours: number): Date =>
      new Date(Date.now() - hours * 60 * 60 * 1000);
    const backdateUpdate = (id: string, when: Date): Promise<unknown> =>
      dataSource.query(
        `UPDATE "videos" SET "updated_at" = $1 WHERE "id" = $2`,
        [when, id],
      );
    const startProcessing = async (title: string) => {
      const draft = await createDraft(title);
      await repository.markUploadCompleted(draft.id);
      await repository.startProcessing(draft.id);
      return draft;
    };

    it('should find only videos in processing that were not touched since the limit', async () => {
      const stuck = await startProcessing('stuck');
      await startProcessing('running'); // updated just now
      const readyOld = await startProcessing('ready');
      await videoRepository.update(
        { id: readyOld.id },
        { status: VideoStatus.READY },
      );
      const draftOld = await createDraft('draft');
      for (const video of [stuck, readyOld, draftOld]) {
        await backdateUpdate(video.id, hoursAgo(3));
      }

      const found = await repository.findStuckProcessing(hoursAgo(1), 10);

      expect(found.map((video) => video.id)).toEqual([stuck.id]);
    });

    it('should refresh updated_at every time processing starts, so a live run never looks stuck', async () => {
      const video = await startProcessing('attempt');
      await backdateUpdate(video.id, hoursAgo(3));

      await repository.startProcessing(video.id); // the next attempt

      expect(await repository.findStuckProcessing(hoursAgo(1), 10)).toEqual([]);
    });

    it('should respect the batch limit, oldest first', async () => {
      const older = await startProcessing('older');
      const newer = await startProcessing('newer');
      await backdateUpdate(older.id, hoursAgo(5));
      await backdateUpdate(newer.id, hoursAgo(4));

      const found = await repository.findStuckProcessing(hoursAgo(1), 1);

      expect(found.map((video) => video.id)).toEqual([older.id]);
    });
  });
});
