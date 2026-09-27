import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../test/create-test-data-source';
import { CategoriesService } from './categories.service';
import { Category } from './entities/category.entity';

describe('CategoriesService (integration)', () => {
  let service: CategoriesService;
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createTestDataSource([Category], { synchronize: false });
    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRootAsync({
          useFactory: () => ({ ...dataSource.options }),
        }),
        TypeOrmModule.forFeature([Category]),
      ],
      providers: [CategoriesService],
    }).compile();
    service = module.get(CategoriesService);
    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('should list the categories ordered by name with outros last', async () => {
    const categories = await service.findAll();

    expect(categories.map(({ slug }) => slug)).toEqual([
      'culinaria',
      'educacao',
      'entretenimento',
      'esportes',
      'filmes-e-animacao',
      'jogos',
      'musica',
      'noticias',
      'tecnologia',
      'viagens',
      'outros',
    ]);
  });

  it('should find a category by slug', async () => {
    const category = await service.findBySlug('musica');

    expect(category).toMatchObject({ slug: 'musica', name: 'Música' });
  });

  it('should return null for an unknown slug', async () => {
    expect(await service.findBySlug('inexistente')).toBeNull();
  });
});
