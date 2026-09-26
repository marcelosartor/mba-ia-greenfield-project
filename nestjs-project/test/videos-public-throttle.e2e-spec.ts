import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { createE2eApp, registerConfirmAndLogin } from './helpers/e2e-app';

// The global ThrottlerGuard allows 10 requests per minute per IP.
const BEYOND_THE_LIMIT = 25;

describe('Rate limit on the public video routes (e2e)', () => {
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

  const statuses = async (path: string): Promise<number[]> => {
    const result: number[] = [];
    for (let i = 0; i < BEYOND_THE_LIMIT; i++) {
      result.push((await request(app.getHttpServer()).get(path)).status);
    }
    return result;
  };

  it.each([
    ['metadata', '/videos/aaaaaaaaaaa'],
    ['stream', '/videos/aaaaaaaaaaa/stream'],
    ['download', '/videos/aaaaaaaaaaa/download'],
  ])('should not throttle the %s route', async (_name, path) => {
    const result = await statuses(path);

    expect(result.filter((status) => status === 429)).toEqual([]);
    expect(new Set(result)).toEqual(new Set([404]));
  });

  it('should keep the limit on the other routes (control)', async () => {
    const result: number[] = [];
    for (let i = 0; i < 12; i++) {
      result.push(
        (
          await request(app.getHttpServer())
            .post('/auth/login')
            .send({ email: 'nobody@example.com', password: 'password123' })
        ).status,
      );
    }

    expect(result.at(-1)).toBe(429);
    expect(result.filter((status) => status === 429).length).toBeGreaterThan(0);
  });

  it('should keep the limit on the authenticated video routes', async () => {
    const token = await registerConfirmAndLogin(app, 'throttle@example.com');
    app.get<ThrottlerStorageService>(ThrottlerStorage).storage.clear();
    const result: number[] = [];
    for (let i = 0; i < 12; i++) {
      result.push(
        (
          await request(app.getHttpServer())
            .post('/videos')
            .set('Authorization', `Bearer ${token}`)
            .send({})
        ).status,
      );
    }

    // an empty body is a 400 until the limit is reached
    expect(result.slice(0, 10).every((status) => status === 400)).toBe(true);
    expect(result.at(-1)).toBe(429);
  });
});
