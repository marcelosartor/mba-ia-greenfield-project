import type { ConfigType } from '@nestjs/config';
import { UnrecoverableError, type Job, type Queue } from 'bullmq';
import type videoConfig from '../config/video.config';
import type { DeadLetteredVideoJobData } from '../queue/queue.types';
import type { StorageService } from '../storage/storage.service';
import type { Video } from '../videos/entities/video.entity';
import { VideoStatus } from '../videos/video-status.enum';
import type { VideosRepository } from '../videos/videos.repository';
import type { MediaProbeService } from './media/media-probe.service';
import { InvalidMediaError, TransientMediaError } from './media/media.errors';
import type { MediaMetadata } from './media/media.types';
import type { ThumbnailService } from './media/thumbnail.service';
import { VideoProcessor } from './video.processor';

const config: ConfigType<typeof videoConfig> = {
  partSizeBytes: 64 * 1024 * 1024,
  workerConcurrency: 1,
  processingTimeoutMs: 1_800_000,
};

const video = {
  id: 'video-1',
  video_key: 'channel-1/video-1/source.mp4',
  status: VideoStatus.DRAFT,
} as Video;

const media: MediaMetadata = {
  duration_seconds: 12,
  width: 1280,
  height: 720,
  video_codec: 'h264',
  audio_codec: 'aac',
  bit_rate: 1000,
  format_name: 'mov,mp4',
  size_bytes: 5000,
  metadata: { format: {} },
};

const makeJob = (
  overrides: { attemptsMade?: number; attempts?: number } = {},
): Job<{ videoId: string }> =>
  ({
    data: { videoId: 'video-1' },
    attemptsMade: overrides.attemptsMade ?? 1,
    opts: { attempts: overrides.attempts ?? 3 },
  }) as unknown as Job<{ videoId: string }>;

describe('VideoProcessor', () => {
  let repository: {
    findById: jest.Mock;
    startProcessing: jest.Mock;
    transitionStatus: jest.Mock;
  };
  let storage: {
    presignGetObject: jest.Mock;
    putObject: jest.Mock;
    videosBucket: string;
    thumbnailsBucket: string;
  };
  let probe: { probe: jest.Mock };
  let thumbnails: { generate: jest.Mock };
  let deadLetterQueue: { add: jest.Mock };
  let processor: VideoProcessor;

  beforeEach(() => {
    repository = {
      findById: jest.fn().mockResolvedValue(video),
      startProcessing: jest.fn().mockResolvedValue(true),
      transitionStatus: jest.fn().mockResolvedValue(true),
    };
    storage = {
      presignGetObject: jest.fn().mockResolvedValue('https://minio/source'),
      putObject: jest.fn().mockResolvedValue(undefined),
      videosBucket: 'videos',
      thumbnailsBucket: 'thumbnails',
    };
    probe = { probe: jest.fn().mockResolvedValue(media) };
    thumbnails = { generate: jest.fn().mockResolvedValue(Buffer.from('jpg')) };
    deadLetterQueue = { add: jest.fn().mockResolvedValue(undefined) };
    processor = new VideoProcessor(
      repository as unknown as VideosRepository,
      storage as unknown as StorageService,
      probe as unknown as MediaProbeService,
      thumbnails as unknown as ThumbnailService,
      deadLetterQueue as unknown as Queue<DeadLetteredVideoJobData>,
      config,
    );
  });

  describe('process', () => {
    it('should finish the video as ready with the metadata and the thumbnail key', async () => {
      await processor.process(makeJob());

      expect(repository.startProcessing).toHaveBeenCalledWith('video-1');
      expect(storage.putObject).toHaveBeenCalledWith(
        'thumbnails',
        'video-1/default.jpg',
        Buffer.from('jpg'),
        'image/jpeg',
      );
      expect(repository.transitionStatus).toHaveBeenCalledWith(
        'video-1',
        VideoStatus.PROCESSING,
        VideoStatus.READY,
        expect.objectContaining({
          duration_seconds: 12,
          width: 1280,
          thumbnail_key: 'video-1/default.jpg',
          error_code: null,
        }),
      );
    });

    it('should do nothing for a video that does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(processor.process(makeJob())).resolves.toBeUndefined();

      expect(repository.startProcessing).not.toHaveBeenCalled();
      expect(probe.probe).not.toHaveBeenCalled();
    });

    it('should not reprocess a video that already left draft/processing', async () => {
      repository.startProcessing.mockResolvedValue(false);

      await expect(processor.process(makeJob())).resolves.toBeUndefined();

      expect(probe.probe).not.toHaveBeenCalled();
      expect(storage.putObject).not.toHaveBeenCalled();
      expect(repository.transitionStatus).not.toHaveBeenCalled();
    });

    it('should not fail when the video left processing before the end', async () => {
      repository.transitionStatus.mockResolvedValue(false);

      await expect(processor.process(makeJob())).resolves.toBeUndefined();
    });

    it.each([
      [
        'the probe',
        () =>
          probe.probe.mockRejectedValue(
            new InvalidMediaError('no video track'),
          ),
      ],
      [
        'the thumbnail',
        () =>
          thumbnails.generate.mockRejectedValue(
            new InvalidMediaError('no video track'),
          ),
      ],
    ])(
      'should end the video in error and stop retrying when %s finds invalid media',
      async (_label, arrange) => {
        arrange();

        await expect(processor.process(makeJob())).rejects.toBeInstanceOf(
          UnrecoverableError,
        );

        expect(repository.transitionStatus).toHaveBeenCalledWith(
          'video-1',
          [VideoStatus.PROCESSING],
          VideoStatus.ERROR,
          { error_code: 'INVALID_MEDIA', error_message: 'no video track' },
        );
      },
    );

    it.each([
      ['a transient media failure', new TransientMediaError('timed out')],
      ['a storage failure', new Error('S3 unavailable')],
    ])(
      'should rethrow %s untouched so BullMQ retries, leaving the video in processing',
      async (_label, failure) => {
        probe.probe.mockRejectedValue(failure);

        await expect(processor.process(makeJob())).rejects.toBe(failure);

        expect(repository.transitionStatus).not.toHaveBeenCalled();
      },
    );

    it('should rethrow a database failure when starting', async () => {
      const failure = new Error('connection lost');
      repository.startProcessing.mockRejectedValue(failure);

      await expect(processor.process(makeJob())).rejects.toBe(failure);
    });
  });

  describe('onFailed', () => {
    it('should dead-letter the job and end the video in error when the attempts are exhausted', async () => {
      await processor.onFailed(
        makeJob({ attemptsMade: 3 }),
        new Error('storage down'),
      );

      expect(repository.transitionStatus).toHaveBeenCalledWith(
        'video-1',
        [VideoStatus.PROCESSING, VideoStatus.DRAFT],
        VideoStatus.ERROR,
        { error_code: 'PROCESSING_FAILED', error_message: 'storage down' },
      );
      expect(deadLetterQueue.add).toHaveBeenCalledWith('dead-lettered-video', {
        videoId: 'video-1',
        failedReason: 'storage down',
        attemptsMade: 3,
      });
    });

    it('should wait for the next attempt while there are attempts left', async () => {
      await processor.onFailed(
        makeJob({ attemptsMade: 2, attempts: 3 }),
        new Error('transient'),
      );

      expect(repository.transitionStatus).not.toHaveBeenCalled();
      expect(deadLetterQueue.add).not.toHaveBeenCalled();
    });

    it('should dead-letter at once a job that has no retry policy', async () => {
      await processor.onFailed(
        makeJob({ attemptsMade: 1, attempts: 1 }),
        new Error('transient'),
      );

      expect(deadLetterQueue.add).toHaveBeenCalledTimes(1);
    });

    it('should ignore an event without a job', async () => {
      await processor.onFailed(undefined, new Error('stalled'));

      expect(repository.transitionStatus).not.toHaveBeenCalled();
    });

    it('should not let the presigned URL of the reason reach the database or the DLQ', async () => {
      await processor.onFailed(
        makeJob({ attemptsMade: 3 }),
        new Error(
          'read failed http://minio:9000/videos/a?X-Amz-Signature=secret',
        ),
      );

      const [, , , changes] = repository.transitionStatus.mock.calls[0] as [
        string,
        unknown,
        unknown,
        { error_message: string },
      ];
      expect(changes.error_message).toBe('read failed <url>');
      expect(deadLetterQueue.add).toHaveBeenCalledWith(
        'dead-lettered-video',
        expect.objectContaining({ failedReason: 'read failed <url>' }),
      );
    });

    it('should cap the recorded reason at 500 characters', async () => {
      await processor.onFailed(
        makeJob({ attemptsMade: 3 }),
        new Error('x'.repeat(2000)),
      );

      const [, , , changes] = repository.transitionStatus.mock.calls[0] as [
        string,
        unknown,
        unknown,
        { error_message: string },
      ];
      expect(changes.error_message).toHaveLength(500);
    });

    it('should log instead of throwing when the dead-letter publication fails', async () => {
      deadLetterQueue.add.mockRejectedValue(new Error('redis down'));

      await expect(
        processor.onFailed(makeJob({ attemptsMade: 3 }), new Error('boom')),
      ).resolves.toBeUndefined();
      expect(repository.transitionStatus).toHaveBeenCalled();
    });

    it('should log instead of throwing when the video update fails', async () => {
      repository.transitionStatus.mockRejectedValue(new Error('db down'));

      await expect(
        processor.onFailed(makeJob({ attemptsMade: 3 }), new Error('boom')),
      ).resolves.toBeUndefined();
    });

    it('should not fail when the video is no longer in a state that can fail', async () => {
      repository.transitionStatus.mockResolvedValue(false);

      await expect(
        processor.onFailed(makeJob({ attemptsMade: 3 }), new Error('boom')),
      ).resolves.toBeUndefined();
      expect(deadLetterQueue.add).toHaveBeenCalled();
    });
  });
});
