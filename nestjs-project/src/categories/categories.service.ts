import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './entities/category.entity';

/** The catch-all category, always listed last. */
export const OTHER_CATEGORY_SLUG = 'outros';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly repository: Repository<Category>,
  ) {}

  /** Every category ordered by name, with `outros` last. */
  async findAll(): Promise<Category[]> {
    return this.repository
      .createQueryBuilder('category')
      .orderBy(
        `CASE WHEN category.slug = '${OTHER_CATEGORY_SLUG}' THEN 1 ELSE 0 END`,
        'ASC',
      )
      .addOrderBy('category.name', 'ASC')
      .getMany();
  }

  async findBySlug(slug: string): Promise<Category | null> {
    return this.repository.findOneBy({ slug });
  }
}
