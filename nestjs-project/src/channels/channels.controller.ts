import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ChannelNotFoundException } from '../common/exceptions/domain.exception';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import {
  AuthenticatedThrottle,
  PublicReadThrottle,
} from '../throttling/throttle-class.decorator';
import {
  PaginatedPanelVideosDto,
  PaginatedPublicVideosDto,
} from '../videos/listing/dto/paginated-videos.dto';
import { VideoListingsService } from '../videos/listing/video-listings.service';
import { ChannelsService } from './channels.service';
import { ChannelResponseDto } from './dto/channel-response.dto';
import { PublicChannelResponseDto } from './dto/public-channel-response.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';

@ApiTags('channels')
@Controller('channels')
export class ChannelsController {
  constructor(
    private readonly channelsService: ChannelsService,
    private readonly videoListingsService: VideoListingsService,
  ) {}

  // Routes under /channels/me are declared before /channels/:nickname so
  // Express never takes `me` for a nickname.

  @Patch('me')
  @AuthenticatedThrottle()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Edit my channel',
    description:
      "Partial edit of the caller's channel: nickname, name and description. Changing the nickname changes the public address, with no redirect.",
  })
  @ApiResponse({
    status: 200,
    description: 'The updated channel',
    type: ChannelResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Empty body, unknown field or invalid value (VALIDATION_ERROR), or reserved nickname (NICKNAME_RESERVED)',
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
    status: 409,
    description:
      'Nickname already used by another channel (NICKNAME_ALREADY_EXISTS)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async updateMine(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateChannelDto,
  ): Promise<ChannelResponseDto> {
    const { name, nickname, description, created_at } =
      await this.channelsService.updateOwn(user.sub, dto);
    return { name, nickname, description, created_at };
  }

  @Get('me/videos')
  @AuthenticatedThrottle()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'List my videos (management panel)',
    description:
      "Every video of the caller's channel, in any status, newest first (created_at, then id), paginated. `views`, `likes` and `comments` are always 0 until Phases 05 and 06. There is no channel parameter and no filter.",
  })
  @ApiResponse({
    status: 200,
    description: 'A page of the panel',
    type: PaginatedPanelVideosDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid page or limit (VALIDATION_ERROR)',
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
  async listMyVideos(
    @CurrentUser() user: JwtPayload,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedPanelVideosDto> {
    const channel = await this.channelsService.findByUserId(user.sub);
    if (!channel) {
      throw new ChannelNotFoundException();
    }
    return this.videoListingsService.listPanel(
      channel.id,
      query.page,
      query.limit,
    );
  }

  @Public()
  @PublicReadThrottle()
  @Get(':nickname')
  @ApiOperation({
    summary: 'Get a channel',
    description:
      'Public page of a channel by its nickname: name, description, creation date and the number of published public videos. Never the id, user id or e-mail.',
  })
  @ApiResponse({
    status: 200,
    description: 'The channel',
    type: PublicChannelResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'No channel with this nickname (CHANNEL_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 429,
    description: 'Too many requests (public-read limit per IP)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getChannel(
    @Param('nickname') nickname: string,
  ): Promise<PublicChannelResponseDto> {
    const channel = await this.channelsService.findByNickname(nickname);
    const video_count = await this.videoListingsService.countListable(
      channel.id,
    );
    const { name, description, created_at } = channel;
    return {
      name,
      nickname: channel.nickname,
      description,
      created_at,
      video_count,
    };
  }

  @Public()
  @PublicReadThrottle()
  @Get(':nickname/videos')
  @ApiOperation({
    summary: "List a channel's public videos",
    description:
      'Published public videos of the channel, newest first (published_at, then id), paginated. Unlisted videos and drafts never appear here.',
  })
  @ApiResponse({
    status: 200,
    description: 'A page of the public listing',
    type: PaginatedPublicVideosDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid page or limit (VALIDATION_ERROR)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'No channel with this nickname (CHANNEL_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 429,
    description: 'Too many requests (public-read limit per IP)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async listChannelVideos(
    @Param('nickname') nickname: string,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedPublicVideosDto> {
    const channel = await this.channelsService.findByNickname(nickname);
    return this.videoListingsService.listPublic(
      channel.id,
      query.page,
      query.limit,
    );
  }
}
