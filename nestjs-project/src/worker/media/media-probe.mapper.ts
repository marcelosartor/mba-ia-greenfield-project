import { InvalidMediaError } from './media.errors';
import type {
  FfprobeOutput,
  FfprobeStream,
  MediaMetadata,
} from './media.types';

function toNumber(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Cover art is exposed by ffprobe as a video stream flagged `attached_pic`.
const isRealVideoStream = (stream: FfprobeStream): boolean =>
  stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1;

function trimStream(stream: FfprobeStream): Record<string, unknown> {
  return {
    index: stream.index,
    codec_type: stream.codec_type,
    codec_name: stream.codec_name,
    profile: stream.profile,
    width: stream.width,
    height: stream.height,
    pix_fmt: stream.pix_fmt,
    r_frame_rate: stream.r_frame_rate,
    avg_frame_rate: stream.avg_frame_rate,
    sample_rate: stream.sample_rate,
    channels: stream.channels,
    duration: stream.duration,
    bit_rate: stream.bit_rate,
  };
}

/** Maps the JSON printed by `ffprobe -show_format -show_streams`. */
export function mapProbeOutput(output: FfprobeOutput): MediaMetadata {
  const streams = output.streams ?? [];
  const video = streams.find(isRealVideoStream);
  if (!video?.codec_name || !video.width || !video.height) {
    throw new InvalidMediaError('The file has no video track');
  }
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  const format = output.format;

  return {
    duration_seconds: toNumber(format?.duration) ?? toNumber(video.duration),
    width: video.width,
    height: video.height,
    video_codec: video.codec_name,
    audio_codec: audio?.codec_name ?? null,
    bit_rate: toNumber(format?.bit_rate),
    format_name: format?.format_name ?? null,
    size_bytes: toNumber(format?.size),
    metadata: {
      format: {
        format_name: format?.format_name,
        format_long_name: format?.format_long_name,
        duration: format?.duration,
        size: format?.size,
        bit_rate: format?.bit_rate,
        nb_streams: format?.nb_streams,
      },
      streams: streams.map(trimStream),
    },
  };
}
