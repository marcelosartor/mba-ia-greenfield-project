import { BadRequestException, Injectable } from '@nestjs/common';
import { CategoriesService } from '../categories/categories.service';
import { InvalidCategoryException } from '../common/exceptions/domain.exception';
import type { VideoResponseDto } from './dto/video-response.dto';
import type { UpdateVideoDto } from './dto/update-video.dto';
import { VideoAccessService } from './video-access.service';
import { VideoOwnershipService } from './video-ownership.service';
import { toVideoResponse } from './video-response.mapper';
import {
  type EditableVideoFields,
  VideosRepository,
} from './videos.repository';

@Injectable()
export class VideosService {
  constructor(
    private readonly videoAccessService: VideoAccessService,
    private readonly videoOwnershipService: VideoOwnershipService,
    private readonly videosRepository: VideosRepository,
    private readonly categoriesService: CategoriesService,
  ) {}

  /** Metadata of a video, under the read access rules of Phase 04. */
  async getVideo(
    publicId: string,
    viewerUserId: string | undefined,
  ): Promise<VideoResponseDto> {
    const video = await this.videoAccessService.loadReadable(
      publicId,
      viewerUserId,
    );
    return toVideoResponse(video);
  }

  /**
   * Partial edit by the owner, in any processing status. Only the fields sent
   * change; the last write wins (no version check, Phase 04 TD-05).
   * @throws BadRequestException (VALIDATION_ERROR) when no field was sent.
   * @throws InvalidCategoryException for an unknown category slug.
   */
  async update(
    userId: string,
    publicId: string,
    dto: UpdateVideoDto,
  ): Promise<VideoResponseDto> {
    if (
      dto.title === undefined &&
      dto.description === undefined &&
      dto.category === undefined &&
      dto.visibility === undefined
    ) {
      throw new BadRequestException(['at least one field must be sent']);
    }

    const video = await this.videoOwnershipService.loadOwned(userId, publicId);

    const changes: EditableVideoFields = {
      title: dto.title,
      description: dto.description,
      visibility: dto.visibility,
    };
    if (dto.category === null) {
      changes.category_id = null;
    } else if (dto.category !== undefined) {
      const category = await this.categoriesService.findBySlug(dto.category);
      if (!category) {
        throw new InvalidCategoryException();
      }
      changes.category_id = category.id;
    }

    await this.videosRepository.updateEditableFields(video.id, changes);
    const updated =
      await this.videosRepository.findByPublicIdWithRelations(publicId);
    return toVideoResponse(updated!);
  }
}
