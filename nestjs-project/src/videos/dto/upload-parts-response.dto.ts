import { ApiProperty } from '@nestjs/swagger';

export class PresignedPartDto {
  @ApiProperty({ example: 1 })
  part_number: number;

  @ApiProperty({
    description: 'Presigned UploadPart URL; send the part bytes with PUT',
  })
  url: string;
}

export class UploadPartsResponseDto {
  @ApiProperty({ type: [PresignedPartDto] })
  parts: PresignedPartDto[];

  @ApiProperty({
    example: 3600,
    description: 'Validity of the URLs, in seconds',
  })
  expires_in: number;
}
