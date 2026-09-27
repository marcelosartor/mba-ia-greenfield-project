import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CategoriesModule } from './categories.module';
import { CategoriesService } from './categories.service';
import { Category } from './entities/category.entity';

describe('CategoriesModule', () => {
  it('should compile and provide CategoriesService', async () => {
    const module = await Test.createTestingModule({
      imports: [CategoriesModule],
    })
      .overrideProvider(getRepositoryToken(Category))
      .useValue({})
      .compile();

    expect(module.get(CategoriesService)).toBeInstanceOf(CategoriesService);
    await module.close();
  });
});
