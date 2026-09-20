import { Readable } from 'node:stream';
import {
  InvalidRangeException,
  StorageUnavailableException,
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import type { StorageService } from '../storage/storage.service';
import type { Video } from './entities/video.entity';
import { VideoStatus } from './video-status.enum';
import { VideoStreamingService } from './video-streaming.service';
import type { VideosRepository } from './videos.repository';

const TOTAL = 3_145_728;

const readyVideo = {
  id: 'video-1',
  public_id: 'abcdefghijk',
  status: VideoStatus.READY,
  video_key: 'channel-1/video-1/source.mp4',
} as Video;

describe('VideoStreamingService', () => {
  let repository: { findByPublicId: jest.Mock };
  let storage: {
    videosBucket: string;
    headObject: jest.Mock;
    getObjectRange: jest.Mock;
  };
  let body: Readable;
  let service: VideoStreamingService;

  beforeEach(() => {
    body = Readable.from([Buffer.from('bytes')]);
    repository = { findByPublicId: jest.fn().mockResolvedValue(readyVideo) };
    storage = {
      videosBucket: 'videos',
      headObject: jest.fn().mockResolvedValue({
        contentLength: TOTAL,
        contentType: 'video/mp4',
        etag: '"head-etag"',
      }),
      getObjectRange: jest.fn().mockResolvedValue({
        body,
        contentLength: TOTAL,
        contentType: 'video/mp4',
        etag: '"etag"',
      }),
    };
    service = new VideoStreamingService(
      repository as unknown as VideosRepository,
      storage as unknown as StorageService,
    );
  });

  describe('videos that cannot be served', () => {
    it('should throw VideoNotFoundException for an unknown public_id', async () => {
      repository.findByPublicId.mockResolvedValue(null);

      await expect(
        service.stream('aaaaaaaaaaa', undefined),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
      expect(storage.headObject).not.toHaveBeenCalled();
    });

    it.each([VideoStatus.DRAFT, VideoStatus.PROCESSING, VideoStatus.ERROR])(
      'should throw VideoNotReadyException for a video in %s',
      async (status) => {
        repository.findByPublicId.mockResolvedValue({ ...readyVideo, status });

        await expect(
          service.stream('abcdefghijk', undefined),
        ).rejects.toBeInstanceOf(VideoNotReadyException);
        expect(storage.headObject).not.toHaveBeenCalled();
        expect(storage.getObjectRange).not.toHaveBeenCalled();
      },
    );
  });

  describe('without a Range header', () => {
    it('should answer 200 with the whole object and the streaming headers', async () => {
      const result = await service.stream('abcdefghijk', undefined);

      expect(storage.getObjectRange).toHaveBeenCalledWith(
        'videos',
        readyVideo.video_key,
        undefined,
      );
      expect(result.statusCode).toBe(200);
      expect(result.body).toBe(body);
      expect(result.headers).toEqual({
        'Content-Type': 'video/mp4',
        'Content-Length': String(TOTAL),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
        ETag: '"etag"',
      });
    });

    it.each(['bytes=0-10,20-30', 'items=0-10', 'bytes=20-10'])(
      'should ignore the header %p and answer 200',
      async (header) => {
        const result = await service.stream('abcdefghijk', header);

        expect(result.statusCode).toBe(200);
        expect(result.headers).not.toHaveProperty('Content-Range');
        expect(storage.getObjectRange).toHaveBeenCalledWith(
          'videos',
          readyVideo.video_key,
          undefined,
        );
      },
    );
  });

  describe('with a satisfiable Range header', () => {
    it('should answer 206 with the range asked for the storage and the matching headers', async () => {
      const result = await service.stream('abcdefghijk', 'bytes=0-1023');

      expect(storage.getObjectRange).toHaveBeenCalledWith(
        'videos',
        readyVideo.video_key,
        'bytes=0-1023',
      );
      expect(result.statusCode).toBe(206);
      expect(result.headers['Content-Range']).toBe(`bytes 0-1023/${TOTAL}`);
      expect(result.headers['Content-Length']).toBe('1024');
      expect(result.headers['Accept-Ranges']).toBe('bytes');
    });

    it('should turn an open range and a suffix into explicit ranges', async () => {
      await service.stream('abcdefghijk', 'bytes=3145000-');
      await service.stream('abcdefghijk', 'bytes=-100');

      const asked = (storage.getObjectRange.mock.calls as unknown[][]).map(
        (call) => call[2],
      );
      expect(asked).toEqual([
        `bytes=3145000-${TOTAL - 1}`,
        `bytes=${TOTAL - 100}-${TOTAL - 1}`,
      ]);
    });

    it('should limit an end beyond the file to the last byte', async () => {
      const result = await service.stream(
        'abcdefghijk',
        'bytes=3145700-99999999',
      );

      expect(result.headers['Content-Range']).toBe(
        `bytes 3145700-${TOTAL - 1}/${TOTAL}`,
      );
      expect(result.headers['Content-Length']).toBe(String(TOTAL - 3145700));
    });
  });

  describe('with an unsatisfiable Range header', () => {
    it('should throw InvalidRangeException carrying the total size, without reading the object', async () => {
      const failure = await service
        .stream('abcdefghijk', 'bytes=9999999-10000000')
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(InvalidRangeException);
      expect((failure as InvalidRangeException).headers).toEqual({
        'Content-Range': `bytes */${TOTAL}`,
      });
      expect(storage.getObjectRange).not.toHaveBeenCalled();
    });
  });

  it('should fall back to the head metadata when the read has none', async () => {
    storage.getObjectRange.mockResolvedValue({ body, contentLength: TOTAL });

    const result = await service.stream('abcdefghijk', undefined);

    expect(result.headers['Content-Type']).toBe('video/mp4');
    expect(result.headers.ETag).toBe('"head-etag"');
  });

  it('should propagate a storage failure', async () => {
    storage.headObject.mockRejectedValue(new StorageUnavailableException());

    await expect(
      service.stream('abcdefghijk', undefined),
    ).rejects.toBeInstanceOf(StorageUnavailableException);
  });
});
