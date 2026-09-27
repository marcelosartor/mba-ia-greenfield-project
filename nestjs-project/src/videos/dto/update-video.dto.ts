import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  IsPlainText,
  NormalizePlainText,
} from '../../common/text/plain-text.util';
import { VideoVisibility } from '../video-visibility.enum';

export const MAX_DESCRIPTION_LENGTH = 5000;

/** Partial edit: an omitted field is not changed; `null` clears a field. */
export class UpdateVideoDto {
  /** 1–100 characters after trimming, plain text. */
  @IsOptional()
  @NormalizePlainText({ trim: true })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @IsPlainText()
  title?: string;

  /** Up to 5,000 characters, plain text; `null` clears it. */
  @ValidateIf((_dto, value) => value !== null && value !== undefined)
  @NormalizePlainText()
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  @IsPlainText()
  description?: string | null;

  /** Category slug (see GET /categories); `null` clears it. */
  @ValidateIf((_dto, value) => value !== null && value !== undefined)
  @IsString()
  @IsNotEmpty()
  category?: string | null;

  /** Changing it does not change `published_at`. */
  @IsOptional()
  @IsEnum(VideoVisibility)
  visibility?: VideoVisibility;
}
