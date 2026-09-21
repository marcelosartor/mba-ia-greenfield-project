import { ApiProperty } from '@nestjs/swagger';
import { VideoStatus } from '../video-status.enum';

export class UploadedPartDto {
  @ApiProperty({ example: 1 })
  part_number: number;

  @ApiProperty({ example: 67108864 })
  size_bytes: number;
}

export class UploadSessionResponseDto {
  @ApiProperty({ example: 'dQw4w9WgXcQ' })
  public_id: string;

  @ApiProperty({ enum: VideoStatus, example: VideoStatus.DRAFT })
  status: VideoStatus;

  @ApiProperty({
    description: 'True once the upload was confirmed as completed',
  })
  upload_completed: boolean;

  @ApiProperty({ example: 67108864 })
  part_size_bytes: number;

  @ApiProperty({
    type: [UploadedPartDto],
    description:
      'Parts already in the storage (used to resume); empty once the upload is completed',
  })
  uploaded_parts: UploadedPartDto[];
}
