import { Controller, Get } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiOptionalBearerAuth } from './api-optional-bearer-auth.decorator';

@Controller('things')
class ThingsController {
  @Get()
  @ApiOptionalBearerAuth()
  list(): string[] {
    return [];
  }
}

describe('ApiOptionalBearerAuth', () => {
  it('declares the operation security as optional: no token or the access-token bearer', async () => {
    const app = await NestFactory.create(
      {
        module: class TestModule {},
        controllers: [ThingsController],
      } as never,
      { logger: false },
    );
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth(undefined, 'access-token').build(),
    );
    await app.close();

    const security = document.paths['/things'].get?.security;
    expect(security).toHaveLength(2);
    expect(security).toEqual(
      expect.arrayContaining([{}, { 'access-token': [] }]),
    );
  });
});
