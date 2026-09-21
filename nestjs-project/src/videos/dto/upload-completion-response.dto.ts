import { ApiProperty } from '@nestjs/swagger';
import { VideoStatus } from '../video-status.enum';

export class UploadCompletionResponseDto {
  @ApiProperty({ example: 'dQw4w9WgXcQ' })
  public_id: string;

  @ApiProperty({
    enum: VideoStatus,
    example: VideoStatus.DRAFT,
    description: 'Still `draft`: the worker moves the video to `processing`',
  })
  status: VideoStatus;

  @ApiProperty({ example: true })
  upload_completed: boolean;
}
