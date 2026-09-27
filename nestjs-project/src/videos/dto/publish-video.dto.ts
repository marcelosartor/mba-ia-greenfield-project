import { IsEnum, IsOptional } from 'class-validator';
import { VideoVisibility } from '../video-visibility.enum';

export class PublishVideoDto {
  /** Defaults to `public`. */
  @IsOptional()
  @IsEnum(VideoVisibility)
  visibility?: VideoVisibility;
}
