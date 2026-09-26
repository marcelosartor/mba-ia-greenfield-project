import { mapProbeOutput } from './media-probe.mapper';
import { InvalidMediaError } from './media.errors';
import type { FfprobeOutput } from './media.types';

const fullOutput: FfprobeOutput = {
  format: {
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    format_long_name: 'QuickTime / MOV',
    duration: '12.345000',
    size: '1048576',
    bit_rate: '679497',
    nb_streams: 2,
  },
  streams: [
    {
      index: 0,
      codec_type: 'video',
      codec_name: 'h264',
      width: 1920,
      height: 1080,
      duration: '12.300000',
    },
    { index: 1, codec_type: 'audio', codec_name: 'aac', sample_rate: '44100' },
  ],
};

describe('mapProbeOutput', () => {
  it('should map format and streams to the video columns', () => {
    const result = mapProbeOutput(fullOutput);

    expect(result).toMatchObject({
      duration_seconds: 12.345,
      width: 1920,
      height: 1080,
      video_codec: 'h264',
      audio_codec: 'aac',
      bit_rate: 679497,
      format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
      size_bytes: 1048576,
    });
  });

  it('should keep a trimmed copy of the output as metadata', () => {
    const { metadata } = mapProbeOutput(fullOutput);

    expect(metadata).toMatchObject({
      format: { format_long_name: 'QuickTime / MOV', nb_streams: 2 },
      streams: [
        { codec_type: 'video', codec_name: 'h264' },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
    });
    expect(JSON.stringify(metadata)).not.toContain('filename');
  });

  it('should leave audio_codec null when there is no audio track', () => {
    const result = mapProbeOutput({
      ...fullOutput,
      streams: [fullOutput.streams![0]],
    });

    expect(result.audio_codec).toBeNull();
  });

  it('should fall back to the video stream duration', () => {
    const result = mapProbeOutput({
      ...fullOutput,
      format: { ...fullOutput.format, duration: undefined },
    });

    expect(result.duration_seconds).toBe(12.3);
  });

  it('should use null for values ffprobe does not report', () => {
    const result = mapProbeOutput({
      format: {},
      streams: [
        { codec_type: 'video', codec_name: 'vp9', width: 640, height: 360 },
      ],
    });

    expect(result).toMatchObject({
      duration_seconds: null,
      bit_rate: null,
      size_bytes: null,
      format_name: null,
    });
  });

  it.each([
    ['no stream at all', { format: fullOutput.format, streams: [] }],
    ['no streams field', { format: fullOutput.format }],
    ['audio only', { streams: [{ codec_type: 'audio', codec_name: 'mp3' }] }],
    [
      'only cover art as video',
      {
        streams: [
          {
            codec_type: 'video',
            codec_name: 'mjpeg',
            width: 500,
            height: 500,
            disposition: { attached_pic: 1 },
          },
          { codec_type: 'audio', codec_name: 'mp3' },
        ],
      },
    ],
    [
      'a video stream without dimensions',
      { streams: [{ codec_type: 'video', codec_name: 'h264' }] },
    ],
  ])('should reject a file with %s', (_label, output) => {
    expect(() => mapProbeOutput(output as FfprobeOutput)).toThrow(
      InvalidMediaError,
    );
  });
});
