import { ApiProperty } from '@nestjs/swagger';
import { PanelVideoItemDto } from './panel-video-item.dto';
import { PublicVideoItemDto } from './public-video-item.dto';

abstract class PageFieldsDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 45 })
  total: number;

  @ApiProperty({ example: 3 })
  total_pages: number;
}

export class PaginatedPanelVideosDto extends PageFieldsDto {
  @ApiProperty({ type: PanelVideoItemDto, isArray: true })
  items: PanelVideoItemDto[];
}

export class PaginatedPublicVideosDto extends PageFieldsDto {
  @ApiProperty({ type: PublicVideoItemDto, isArray: true })
  items: PublicVideoItemDto[];
}
