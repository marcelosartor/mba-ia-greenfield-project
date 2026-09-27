import { Controller, Get } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { PublicReadThrottle } from '../throttling/throttle-class.decorator';
import { CategoriesService } from './categories.service';
import { CategoryResponseDto } from './dto/category-response.dto';

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Public()
  @PublicReadThrottle()
  @Get()
  @ApiOperation({
    summary: 'List the video categories',
    description:
      'Categories maintained by the platform, ordered by name with `outros` last. The client uses the `slug` when editing a video.',
  })
  @ApiResponse({
    status: 200,
    description: 'Categories',
    type: CategoryResponseDto,
    isArray: true,
  })
  @ApiResponse({
    status: 429,
    description: 'Too many requests (public-read limit per IP)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async list(): Promise<CategoryResponseDto[]> {
    const categories = await this.categoriesService.findAll();
    return categories.map(({ slug, name }) => ({ slug, name }));
  }
}
