import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  IsPlainText,
  NormalizePlainText,
} from '../../common/text/plain-text.util';
import { NICKNAME_PATTERN } from '../nickname.util';

export const MAX_CHANNEL_DESCRIPTION_LENGTH = 5000;

/** Partial edit of the caller's channel; at least one field. */
export class UpdateChannelDto {
  /** `^[a-z0-9_]{3,50}$`, not reserved; changes the public address. */
  @IsOptional()
  @IsString()
  @Matches(NICKNAME_PATTERN, {
    message: 'nickname must match ^[a-z0-9_]{3,50}$',
  })
  nickname?: string;

  /** 1–50 characters after trimming, plain text. */
  @IsOptional()
  @NormalizePlainText({ trim: true })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @IsPlainText()
  name?: string;

  /** Up to 5,000 characters, plain text; `null` clears it. */
  @ValidateIf((_dto, value) => value !== null && value !== undefined)
  @NormalizePlainText()
  @IsString()
  @MaxLength(MAX_CHANNEL_DESCRIPTION_LENGTH)
  @IsPlainText()
  description?: string | null;
}
