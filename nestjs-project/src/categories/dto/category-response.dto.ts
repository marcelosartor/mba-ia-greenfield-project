import { ApiProperty } from '@nestjs/swagger';

export class CategoryResponseDto {
  @ApiProperty({ example: 'musica' })
  slug: string;

  @ApiProperty({ example: 'Música' })
  name: string;
}
