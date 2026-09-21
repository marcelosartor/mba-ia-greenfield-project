import type { VideoStatus } from './video-status.enum';

export interface InitiatedUpload {
  public_id: string;
  status: VideoStatus;
  part_size_bytes: number;
  part_count: number;
}
