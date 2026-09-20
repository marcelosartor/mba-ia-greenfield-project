import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CreateVideoDto } from './dto/create-video.dto';
import { RequestUploadPartsDto } from './dto/request-upload-parts.dto';
import { VideoResponseDto } from './dto/video-response.dto';
import { UploadCompletionResponseDto } from './dto/upload-completion-response.dto';
import { UploadPartsResponseDto } from './dto/upload-parts-response.dto';
import { UploadSessionResponseDto } from './dto/upload-session-response.dto';
import { VideoStreamingService } from './video-streaming.service';
import { VideoUploadsService } from './video-uploads.service';
import { VideosService } from './videos.service';
import type { InitiatedUpload } from './videos.types';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(
    private readonly videoUploadsService: VideoUploadsService,
    private readonly videosService: VideosService,
    private readonly videoStreamingService: VideoStreamingService,
  ) {}

  @Post()
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Start a video upload',
    description:
      "Creates the video as a draft in the authenticated user's channel and opens the multipart upload in the object storage. The part size is defined by the server.",
  })
  @ApiResponse({
    status: 201,
    description: 'Upload started',
    schema: {
      properties: {
        public_id: { type: 'string', example: 'dQw4w9WgXcQ' },
        status: { type: 'string', example: 'draft' },
        part_size_bytes: { type: 'integer', example: 67108864 },
        part_count: { type: 'integer', example: 3 },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Authenticated user has no channel (CHANNEL_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 413,
    description: 'File larger than 10 GiB (VIDEO_TOO_LARGE)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 415,
    description:
      'Extension or content type outside the allowlist (UNSUPPORTED_VIDEO_FORMAT)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 502,
    description: 'Object storage unavailable (STORAGE_UNAVAILABLE)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoDto,
  ): Promise<InitiatedUpload> {
    return this.videoUploadsService.initiate(user.sub, dto);
  }

  @Get(':publicId/upload')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get the state of an upload',
    description:
      'Lists the parts already stored so an interrupted upload can be resumed. Only the owner of the video can call it; once the upload is completed the list of parts is empty.',
  })
  @ApiResponse({
    status: 200,
    description: 'Upload session',
    type: UploadSessionResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'The video belongs to another channel (VIDEO_ACCESS_DENIED)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 502,
    description: 'Object storage unavailable (STORAGE_UNAVAILABLE)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getUploadSession(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ): Promise<UploadSessionResponseDto> {
    return this.videoUploadsService.getUploadSession(user.sub, publicId);
  }

  @Post(':publicId/upload/parts')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Get presigned URLs for upload parts',
    description:
      'Issues presigned UploadPart URLs (valid for one hour) so the client sends each part straight to the object storage, without the bytes going through the API. Only the owner can call it, and only while the upload is not completed.',
  })
  @ApiResponse({
    status: 201,
    description: 'Presigned URLs',
    type: UploadPartsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'The video belongs to another channel (VIDEO_ACCESS_DENIED)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Upload already completed (UPLOAD_ALREADY_COMPLETED)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 502,
    description: 'Object storage unavailable (STORAGE_UNAVAILABLE)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async requestPartUrls(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: RequestUploadPartsDto,
  ): Promise<UploadPartsResponseDto> {
    return this.videoUploadsService.requestPartUrls(user.sub, publicId, dto);
  }

  @Post(':publicId/upload/completion')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Complete a video upload',
    description:
      'Validates the uploaded parts, completes the multipart upload and queues the video for processing. Idempotent: repeating the call for an already completed upload returns the same answer without queuing another job.',
  })
  @ApiResponse({
    status: 202,
    description: 'Upload completed; processing queued',
    type: UploadCompletionResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'The video belongs to another channel (VIDEO_ACCESS_DENIED)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description:
      'Parts missing, out of sequence or with an unexpected size (UPLOAD_INCOMPLETE)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 413,
    description:
      'Parts add up to more than 10 GiB; the draft is discarded (VIDEO_TOO_LARGE)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 502,
    description: 'Object storage unavailable (STORAGE_UNAVAILABLE)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ): Promise<UploadCompletionResponseDto> {
    return this.videoUploadsService.completeUpload(user.sub, publicId);
  }

  @Public()
  @Get(':publicId')
  @ApiOperation({
    summary: 'Get a video',
    description:
      'Public metadata of a video, by its public identifier. Only videos that finished processing (`ready`) are served.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video metadata',
    type: VideoResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is draft, processing or in error (VIDEO_NOT_READY)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getVideo(
    @Param('publicId') publicId: string,
  ): Promise<VideoResponseDto> {
    return this.videosService.getReadyVideo(publicId);
  }

  @Public()
  @Get(':publicId/stream')
  @ApiOperation({
    summary: 'Stream a video',
    description:
      'Serves the video file from the object storage without loading it into memory. Supports a single-range `Range` header (206 Partial Content); any other `Range` value is ignored and the whole file is sent.',
  })
  @ApiHeader({
    name: 'Range',
    required: false,
    description: 'A single byte range, e.g. `bytes=0-1023`',
  })
  @ApiResponse({
    status: 200,
    description: 'The whole video file',
    content: {
      'video/mp4': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({
    status: 206,
    description: 'The requested byte range, with a `Content-Range` header',
    content: {
      'video/mp4': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is draft, processing or in error (VIDEO_NOT_READY)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 416,
    description:
      'Range not satisfiable (INVALID_RANGE); `Content-Range: bytes */{total}`',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 502,
    description: 'Object storage unavailable (STORAGE_UNAVAILABLE)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async streamVideo(
    @Param('publicId') publicId: string,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const video = await this.videoStreamingService.stream(publicId, range);
    response.status(video.statusCode);
    response.set(video.headers);
    // Nest pipes the stream to the response but does not stop the source when
    // the client goes away; without this the storage read would stay open.
    response.once('close', () => video.body.destroy());
    return new StreamableFile(video.body);
  }
}
