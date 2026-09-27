import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Public } from '../src/auth/decorators/public.decorator';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { PublicReadThrottle } from '../src/throttling/throttle-class.decorator';
import { createE2eApp, registerConfirmAndLogin } from './helpers/e2e-app';

// A public route marked like the Phase 04 public reads, to prove the
// configurable `public-read` limit without depending on a real endpoint.
@Controller('throttling-probe')
class PublicReadProbeController {
  @Public()
  @PublicReadThrottle()
  @Get()
  probe(): { ok: true } {
    return { ok: true };
  }
}

const statuses = async (
  times: number,
  send: () => request.Test,
): Promise<number[]> => {
  const result: number[] = [];
  for (let i = 0; i < times; i++) result.push((await send()).status);
  return result;
};

describe('Named throttlers (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tokenA: string;
  let tokenB: string;
  const previousPublicReadLimit = process.env.THROTTLE_PUBLIC_READ_LIMIT;

  beforeAll(async () => {
    process.env.THROTTLE_PUBLIC_READ_LIMIT = '5';
    app = await createE2eApp(
      Test.createTestingModule({
        imports: [AppModule],
        controllers: [PublicReadProbeController],
      }),
    );
    dataSource = app.get(DataSource);
    await cleanAllTables(dataSource);
    tokenA = await registerConfirmAndLogin(app, 'throttle-a@example.com');
    tokenB = await registerConfirmAndLogin(app, 'throttle-b@example.com');
  });

  afterAll(async () => {
    await cleanAllTables(dataSource);
    await app.close();
    if (previousPublicReadLimit === undefined) {
      delete process.env.THROTTLE_PUBLIC_READ_LIMIT;
    } else {
      process.env.THROTTLE_PUBLIC_READ_LIMIT = previousPublicReadLimit;
    }
  });

  beforeEach(() => {
    app.get<ThrottlerStorageService>(ThrottlerStorage).storage.clear();
  });

  it('answers 429 to the 121st call of a user to an authenticated route, without affecting another user', async () => {
    const result = await statuses(121, () =>
      request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${tokenA}`),
    );

    expect(result.slice(0, 120).every((status) => status === 200)).toBe(true);
    expect(result[120]).toBe(429);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
  });

  it('answers 429 to the 21st upload call of a user in a minute', async () => {
    const result = await statuses(21, () =>
      request(app.getHttpServer())
        .post('/videos/aaaaaaaaaaa/upload/parts')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ part_numbers: [1] }),
    );

    expect(result.slice(0, 20).every((status) => status !== 429)).toBe(true);
    expect(result[20]).toBe(429);
  });

  it('keeps the login limit at 10 per minute per IP', async () => {
    const result = await statuses(11, () =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nobody@example.com', password: 'password123' }),
    );

    expect(result.slice(0, 10).every((status) => status !== 429)).toBe(true);
    expect(result[10]).toBe(429);
  });

  it('never throttles the video reads', async () => {
    const result = await statuses(25, () =>
      request(app.getHttpServer()).get('/videos/aaaaaaaaaaa'),
    );

    expect(new Set(result)).toEqual(new Set([404]));
  });

  it('applies the configurable public-read limit per IP', async () => {
    const result = await statuses(6, () =>
      request(app.getHttpServer()).get('/throttling-probe'),
    );

    expect(result.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(result[5]).toBe(429);
  });
});
