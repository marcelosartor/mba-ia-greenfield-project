import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class CreateVideoDto {
  /** Original file name; the extension must be one of mp4, mov, mkv or webm. */
  @IsString()
  @IsNotEmpty()
  filename: string;

  /** Media type matching the extension, e.g. `video/mp4`. */
  @IsString()
  @IsNotEmpty()
  content_type: string;

  /** File size in bytes, from 1 up to 10 GiB. */
  @IsInt()
  @Min(1)
  size_bytes: number;
}
