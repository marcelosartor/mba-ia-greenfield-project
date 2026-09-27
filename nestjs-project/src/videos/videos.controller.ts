import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseFilePipe,
  Patch,
  Post,
  Put,
  Res,
  StreamableFile,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiParam,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { Readable } from 'node:stream';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator';
import { OptionalCurrentUser } from '../auth/decorators/optional-current-user.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { ApiOptionalBearerAuth } from '../common/openapi/api-optional-bearer-auth.decorator';
import {
  AuthenticatedThrottle,
  PublicReadThrottle,
  UploadsThrottle,
} from '../throttling/throttle-class.decorator';
import { CreateVideoDto } from './dto/create-video.dto';
import { RequestUploadPartsDto } from './dto/request-upload-parts.dto';
import { PublishVideoDto } from './dto/publish-video.dto';
import { UpdateVideoDto } from './dto/update-video.dto';
import { VideoResponseDto } from './dto/video-response.dto';
import { UploadCompletionResponseDto } from './dto/upload-completion-response.dto';
import { UploadPartsResponseDto } from './dto/upload-parts-response.dto';
import { UploadSessionResponseDto } from './dto/upload-session-response.dto';
import { ImageTooLargeFilter } from './thumbnails/image-too-large.filter';
import { VideoThumbnailsService } from './thumbnails/video-thumbnails.service';
import { VideoPublicationService } from './video-publication.service';
import {
  PRIVATE_NO_CACHE,
  VideoStreamingService,
} from './video-streaming.service';
import { VideoUploadsService } from './video-uploads.service';
import { VideosService } from './videos.service';
import type { InitiatedUpload } from './videos.types';

// The public reading routes opt out of every throttler: a player issues one
// Range request per seek and would be answered 429 within seconds. The upload
// routes use the per-user `uploads` throttler (src/throttling).
/** Custom cover upload limit, enforced by Multer while the body streams in. */
const MAX_CUSTOM_THUMBNAIL_BYTES = 2 * 1024 * 1024;

/** The part of a Multer file this controller reads (memory storage). */
interface UploadedImage {
  buffer: Buffer;
}

const ApiPublicIdParam = () =>
  ApiParam({
    name: 'public_id',
    description: 'Public identifier of the video (11 URL-safe characters)',
    example: 'dQw4w9WgXcQ',
  });

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(
    private readonly videoUploadsService: VideoUploadsService,
    private readonly videosService: VideosService,
    private readonly videoStreamingService: VideoStreamingService,
    private readonly videoPublicationService: VideoPublicationService,
    private readonly videoThumbnailsService: VideoThumbnailsService,
  ) {}

  @Post()
  @UploadsThrottle()
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

  @Get(':public_id/upload')
  @UploadsThrottle()
  @ApiPublicIdParam()
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
    @Param('public_id') publicId: string,
  ): Promise<UploadSessionResponseDto> {
    return this.videoUploadsService.getUploadSession(user.sub, publicId);
  }

  @Post(':public_id/upload/parts')
  @UploadsThrottle()
  @ApiPublicIdParam()
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
    description:
      'Validation failed, or a part number beyond the parts of the declared size (INVALID_PART_NUMBER)',
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
    @Param('public_id') publicId: string,
    @Body() dto: RequestUploadPartsDto,
  ): Promise<UploadPartsResponseDto> {
    return this.videoUploadsService.requestPartUrls(user.sub, publicId, dto);
  }

  @Post(':public_id/upload/completion')
  @UploadsThrottle()
  @ApiPublicIdParam()
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
    @Param('public_id') publicId: string,
  ): Promise<UploadCompletionResponseDto> {
    return this.videoUploadsService.completeUpload(user.sub, publicId);
  }

  @OptionalAuth()
  @SkipThrottle()
  @Get(':public_id')
  @Header('Cache-Control', PRIVATE_NO_CACHE)
  @ApiPublicIdParam()
  @ApiOptionalBearerAuth()
  @ApiOperation({
    summary: 'Get a video',
    description:
      'Metadata of a video, by its public identifier. A published video is readable by anyone; a draft only by the owner of its channel (anyone else gets 404). A video that is not `ready` is a 409, which only the owner reaches. The token is optional and only read from the `Authorization` header.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video metadata (`Cache-Control: private, no-cache`)',
    type: VideoResponseDto,
  })
  @ApiResponse({
    status: 404,
    description:
      'Video not found, or a draft requested by someone other than the owner (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description:
      'Video is still processing or in error, requested by the owner (VIDEO_NOT_READY)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getVideo(
    @Param('public_id') publicId: string,
    @OptionalCurrentUser() viewer: JwtPayload | undefined,
  ): Promise<VideoResponseDto> {
    return this.videosService.getVideo(publicId, viewer?.sub);
  }

  @Patch(':public_id')
  @AuthenticatedThrottle()
  @ApiPublicIdParam()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Edit a video',
    description:
      'Partial edit of title, description, category (by slug) and visibility by the owner, in any processing status. An omitted field is not changed and `null` clears description or category; changing the visibility does not change `published_at`. The last write wins.',
  })
  @ApiResponse({
    status: 200,
    description: 'The updated video',
    type: VideoResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Empty body, unknown field or invalid value (VALIDATION_ERROR), or unknown category slug (INVALID_CATEGORY)',
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
  async updateVideo(
    @CurrentUser() user: JwtPayload,
    @Param('public_id') publicId: string,
    @Body() dto: UpdateVideoDto,
  ): Promise<VideoResponseDto> {
    return this.videosService.update(user.sub, publicId, dto);
  }

  @Post(':public_id/publication')
  @HttpCode(HttpStatus.OK)
  @AuthenticatedThrottle()
  @ApiPublicIdParam()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Publish a video',
    description:
      'Publishes a video that finished processing, `public` by default or `unlisted`. Every call writes `published_at` again (republishing refreshes it). Owner only.',
  })
  @ApiResponse({
    status: 200,
    description: 'The published video',
    type: VideoResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid visibility or unknown field (VALIDATION_ERROR)',
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
    description: 'The video is not ready yet (VIDEO_NOT_PUBLISHABLE)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async publishVideo(
    @CurrentUser() user: JwtPayload,
    @Param('public_id') publicId: string,
    @Body() dto: PublishVideoDto,
  ): Promise<VideoResponseDto> {
    return this.videoPublicationService.publish(
      user.sub,
      publicId,
      dto.visibility,
    );
  }

  @Delete(':public_id/publication')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuthenticatedThrottle()
  @ApiPublicIdParam()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Unpublish a video',
    description:
      'Takes the video back to draft: anyone but the owner stops reading it. The visibility is kept. Idempotent (a draft also answers 204). Owner only.',
  })
  @ApiResponse({ status: 204, description: 'Unpublished' })
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
  async unpublishVideo(
    @CurrentUser() user: JwtPayload,
    @Param('public_id') publicId: string,
  ): Promise<void> {
    await this.videoPublicationService.unpublish(user.sub, publicId);
  }

  @OptionalAuth()
  @SkipThrottle()
  @Get(':public_id/stream')
  @ApiPublicIdParam()
  @ApiOptionalBearerAuth()
  @ApiOperation({
    summary: 'Stream a video',
    description:
      'Serves the video file from the object storage without loading it into memory, under the same access rules as the metadata: a draft only for the owner (anyone else gets 404), then 409 while not `ready`. Supports a single-range `Range` header (206 Partial Content); any other `Range` value is ignored and the whole file is sent.',
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
    description:
      'Video not found, or a draft requested by someone other than the owner (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description:
      'Video is still processing or in error, requested by the owner (VIDEO_NOT_READY)',
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
    @Param('public_id') publicId: string,
    @Headers('range') range: string | undefined,
    @OptionalCurrentUser() viewer: JwtPayload | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const video = await this.videoStreamingService.stream(
      publicId,
      range,
      viewer?.sub,
    );
    response.status(video.statusCode);
    return this.pipeStorageBody(response, video.headers, video.body);
  }

  @OptionalAuth()
  @SkipThrottle()
  @Get(':public_id/download')
  @ApiPublicIdParam()
  @ApiOptionalBearerAuth()
  @ApiOperation({
    summary: 'Download a video',
    description:
      'Sends the whole video file as an attachment, streamed from the object storage without loading it into memory, under the same access rules as the metadata: a draft only for the owner (anyone else gets 404), then 409 while not `ready`.',
  })
  @ApiResponse({
    status: 200,
    description:
      'The video file, with a `Content-Disposition: attachment` header',
    content: {
      'video/mp4': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({
    status: 404,
    description:
      'Video not found, or a draft requested by someone other than the owner (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description:
      'Video is still processing or in error, requested by the owner (VIDEO_NOT_READY)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 502,
    description: 'Object storage unavailable (STORAGE_UNAVAILABLE)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async downloadVideo(
    @Param('public_id') publicId: string,
    @OptionalCurrentUser() viewer: JwtPayload | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const video = await this.videoStreamingService.download(
      publicId,
      viewer?.sub,
    );
    return this.pipeStorageBody(response, video.headers, video.body);
  }

  @OptionalAuth()
  @PublicReadThrottle()
  @Get(':public_id/thumbnail')
  @ApiPublicIdParam()
  @ApiOptionalBearerAuth()
  @ApiOperation({
    summary: 'Get the cover of a video',
    description:
      "Streams the video's cover: the owner's custom thumbnail if there is one, else the one generated by the worker. Same access rules as the metadata: a draft only for the owner (anyone else gets 404), then 409 while not `ready`.",
  })
  @ApiResponse({
    status: 200,
    description: 'The cover as a JPEG (`Cache-Control: private, no-cache`)',
    content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiResponse({
    status: 404,
    description:
      'Video not found, a draft requested by someone other than the owner, or a video without any cover (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description:
      'Video is still processing or in error, requested by the owner (VIDEO_NOT_READY)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 429,
    description: 'Too many requests (public-read limit per IP)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 502,
    description: 'Object storage unavailable (STORAGE_UNAVAILABLE)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getThumbnail(
    @Param('public_id') publicId: string,
    @OptionalCurrentUser() viewer: JwtPayload | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const thumbnail = await this.videoThumbnailsService.getThumbnail(
      publicId,
      viewer?.sub,
    );
    return this.pipeStorageBody(response, thumbnail.headers, thumbnail.body);
  }

  @Put(':public_id/thumbnail')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UploadsThrottle()
  @UseFilters(ImageTooLargeFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_CUSTOM_THUMBNAIL_BYTES, files: 1 },
    }),
  )
  @ApiPublicIdParam()
  @ApiBearerAuth('access-token')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'JPEG, PNG or static WebP, up to 2 MiB',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Set a custom cover',
    description:
      'Replaces the cover with an image of the owner, in any processing status. The image is validated by its content (JPEG, PNG or static WebP, up to 2 MiB) and re-encoded as a JPEG 640 px wide, without metadata. The worker never overwrites it.',
  })
  @ApiResponse({ status: 204, description: 'Cover replaced' })
  @ApiResponse({
    status: 400,
    description: 'The `file` field is missing (VALIDATION_ERROR)',
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
    status: 413,
    description: 'The image exceeds 2 MiB (IMAGE_TOO_LARGE)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 415,
    description:
      'Not a JPEG, PNG or static WebP by its content, above the pixel limit, or undecodable (INVALID_IMAGE)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 502,
    description: 'Object storage unavailable (STORAGE_UNAVAILABLE)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async setThumbnail(
    @CurrentUser() user: JwtPayload,
    @Param('public_id') publicId: string,
    @UploadedFile(new ParseFilePipe({ fileIsRequired: true }))
    file: UploadedImage,
  ): Promise<void> {
    await this.videoThumbnailsService.setCustom(
      user.sub,
      publicId,
      file.buffer,
    );
  }

  @Delete(':public_id/thumbnail')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UploadsThrottle()
  @ApiPublicIdParam()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Remove the custom cover',
    description:
      'Removes the custom cover, so the one generated by the worker is served again. Idempotent (a video without a custom cover also answers 204). Owner only.',
  })
  @ApiResponse({ status: 204, description: 'Custom cover removed' })
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
  async removeThumbnail(
    @CurrentUser() user: JwtPayload,
    @Param('public_id') publicId: string,
  ): Promise<void> {
    await this.videoThumbnailsService.removeCustom(user.sub, publicId);
  }

  private pipeStorageBody(
    response: Response,
    headers: Record<string, string>,
    body: Readable,
  ): StreamableFile {
    response.set(headers);
    // Nest pipes the stream to the response but does not stop the source when
    // the client goes away; without this the storage read would stay open.
    response.once('close', () => body.destroy());
    return new StreamableFile(body);
  }
}
