import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { DomainExceptionFilter } from '../../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../../src/common/filters/validation-exception.filter';
import { MailService } from '../../src/mail/mail.service';

export const TEST_PASSWORD = 'password123';

export function buildTestingModule(): TestingModuleBuilder {
  return Test.createTestingModule({ imports: [AppModule] });
}

/** Reproduces the global pipe and filters that `main.ts` registers. */
export async function createE2eApp(
  builder: TestingModuleBuilder = buildTestingModule(),
): Promise<INestApplication<App>> {
  const moduleFixture = await builder.compile();
  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(
    new DomainExceptionFilter(),
    new ValidationExceptionFilter(),
  );
  await app.init();
  return app;
}

/** Registers, confirms and logs in a user (which also creates their channel). */
export async function registerConfirmAndLogin(
  app: INestApplication<App>,
  email: string,
): Promise<string> {
  const mailService = app.get(MailService);
  let confirmationToken = '';
  const spy = jest
    .spyOn(mailService, 'sendConfirmationEmail')
    .mockImplementationOnce((_email: string, _name: string, token: string) => {
      confirmationToken = token;
      return Promise.resolve();
    });
  await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: TEST_PASSWORD })
    .expect(201);
  spy.mockRestore();
  await request(app.getHttpServer())
    .get('/auth/confirm-email')
    .query({ token: confirmationToken })
    .expect(204);
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: TEST_PASSWORD })
    .expect(200);
  return (login.body as { access_token: string }).access_token;
}
