export interface MediaMetadata {
  duration_seconds: number | null;
  width: number;
  height: number;
  video_codec: string;
  audio_codec: string | null;
  bit_rate: number | null;
  format_name: string | null;
  size_bytes: number | null;
  /** Trimmed ffprobe output, stored as JSONB. */
  metadata: Record<string, unknown>;
}

export interface FfprobeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
  bit_rate?: string;
  disposition?: { attached_pic?: number };
}

export interface FfprobeFormat {
  format_name?: string;
  format_long_name?: string;
  duration?: string;
  size?: string;
  bit_rate?: string;
  nb_streams?: number;
}

export interface FfprobeOutput {
  format?: FfprobeFormat;
  streams?: FfprobeStream[];
}
