import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  Max,
  Min,
} from 'class-validator';
import {
  MAX_PART_NUMBER,
  MAX_PARTS_PER_REQUEST,
} from '../video-upload.constants';

export class RequestUploadPartsDto {
  /** Distinct part numbers to presign, from 1 to 10000 (up to 100 per call). */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PARTS_PER_REQUEST)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(MAX_PART_NUMBER, { each: true })
  part_numbers: number[];
}
