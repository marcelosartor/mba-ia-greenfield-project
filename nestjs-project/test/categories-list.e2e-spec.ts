import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { INITIAL_CATEGORIES } from '../src/database/migrations/1790521625754-SeedCategories';
import { createE2eApp } from './helpers/e2e-app';

describe('categories-list', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    app.get<ThrottlerStorageService>(ThrottlerStorage).storage.clear();
  });

  // 1. Listar as categorias

  it('lista-inicial-ordenada-sem-autenticacao', async () => {
    const response = await request(app.getHttpServer())
      .get('/categories')
      .expect(200);

    const body = response.body as Record<string, unknown>[];
    expect(body).toHaveLength(11);
    for (const item of body) {
      expect(Object.keys(item).sort()).toEqual(['name', 'slug']);
    }
    expect(body.map((item) => item.slug).sort()).toEqual(
      INITIAL_CATEGORIES.map(({ slug }) => slug).sort(),
    );
    expect(body.at(-1)?.slug).toBe('outros');
    const names = body.slice(0, 10).map((item) => item.name as string);
    expect(names).toEqual(
      [...names].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    );
  });

  it('rota-publica-nao-recebe-429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      statuses.push(
        (await request(app.getHttpServer()).get('/categories')).status,
      );
    }

    expect(new Set(statuses)).toEqual(new Set([200]));
  });
});
