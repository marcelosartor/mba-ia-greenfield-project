import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportSpec } from './openapi-export';

describe('exportSpec (integration)', () => {
  let outputPath: string;
  let document: Record<string, unknown>;

  beforeAll(async () => {
    outputPath = join(tmpdir(), `openapi-test-${Date.now()}.json`);
    await exportSpec(outputPath);
    document = JSON.parse(readFileSync(outputPath, 'utf-8')) as Record<
      string,
      unknown
    >;
  }, 30_000);

  it('exports a valid OpenAPI 3.x document', () => {
    expect(document.openapi).toMatch(/^3\./);
  });

  it('sets info.title to "StreamTube API"', () => {
    const info = document.info as Record<string, unknown>;
    expect(info.title).toBe('StreamTube API');
  });

  it('sets info.version to "1.0"', () => {
    const info = document.info as Record<string, unknown>;
    expect(info.version).toBe('1.0');
  });

  it('includes access-token Bearer security scheme', () => {
    const components = document.components as Record<string, unknown>;
    const schemes = components.securitySchemes as Record<
      string,
      Record<string, unknown>
    >;
    expect(schemes['access-token']).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
  });

  it('includes non-empty components.schemas from DTO inference', () => {
    const components = document.components as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;
    expect(Object.keys(schemas).length).toBeGreaterThan(0);
  });

  it('includes ApiErrorEnvelope schema with expected properties', () => {
    const components = document.components as Record<string, unknown>;
    const schemas = components.schemas as Record<
      string,
      Record<string, unknown>
    >;
    expect(schemas['ApiErrorEnvelope']).toBeDefined();
    const props = schemas['ApiErrorEnvelope'].properties as Record<
      string,
      unknown
    >;
    expect(props).toHaveProperty('statusCode');
    expect(props).toHaveProperty('error');
    expect(props).toHaveProperty('message');
    expect(props).toHaveProperty('code');
  });

  it('has at least one path with a 401 response referencing ApiErrorEnvelope', () => {
    const paths = document.paths as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const apiErrorRef = '#/components/schemas/ApiErrorEnvelope';

    const hasRef = Object.values(paths).some((methods) =>
      Object.values(methods).some((operation) => {
        const responses = operation.responses as Record<
          string,
          Record<string, unknown>
        >;
        const r401 = responses?.['401'];
        if (!r401) return false;
        const content = r401.content as Record<string, Record<string, unknown>>;
        const jsonContent = content?.['application/json'];
        const schema = jsonContent?.schema as Record<string, unknown>;
        return schema?.['$ref'] === apiErrorRef;
      }),
    );

    expect(hasRef).toBe(true);
  });

  it('protected auth endpoints include access-token security requirement', () => {
    const paths = document.paths as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const protectedPaths = [
      { path: '/auth/logout', method: 'post' },
      { path: '/auth/me', method: 'get' },
    ];

    for (const { path, method } of protectedPaths) {
      const operation = paths[path]?.[method];
      expect(operation).toBeDefined();
      const security = operation?.security as Array<Record<string, unknown>>;
      expect(security).toBeDefined();
      expect(security.some((req) => 'access-token' in req)).toBe(true);
    }
  });

  it('all auth endpoints have a non-empty summary', () => {
    const paths = document.paths as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const authPaths = Object.entries(paths).filter(([p]) =>
      p.startsWith('/auth/'),
    );

    expect(authPaths.length).toBeGreaterThan(0);

    for (const [, methods] of authPaths) {
      for (const operation of Object.values(methods)) {
        expect(typeof operation.summary).toBe('string');
        expect((operation.summary as string).length).toBeGreaterThan(0);
      }
    }
  });

  describe('video endpoints', () => {
    type Operation = Record<string, unknown>;
    const VIDEO_OPERATIONS = [
      { method: 'post', path: '/videos', protected: true },
      { method: 'get', path: '/videos/{public_id}/upload', protected: true },
      {
        method: 'post',
        path: '/videos/{public_id}/upload/parts',
        protected: true,
      },
      {
        method: 'post',
        path: '/videos/{public_id}/upload/completion',
        protected: true,
      },
      { method: 'get', path: '/videos/{public_id}', protected: false },
      { method: 'get', path: '/videos/{public_id}/stream', protected: false },
      { method: 'get', path: '/videos/{public_id}/download', protected: false },
    ];

    const operationOf = (
      document: Record<string, unknown>,
      path: string,
      method: string,
    ) =>
      (document.paths as Record<string, Record<string, Operation>>)[path]?.[
        method
      ];

    it.each(VIDEO_OPERATIONS)(
      'documents $method $path under the videos tag with a summary',
      ({ method, path }) => {
        const operation = operationOf(document, path, method);

        expect(operation).toBeDefined();
        expect(operation.tags).toEqual(['videos']);
        expect(typeof operation.summary).toBe('string');
      },
    );

    it.each(VIDEO_OPERATIONS)(
      'requires the access token only where the endpoint is not public: $method $path',
      ({ method, path, protected: isProtected }) => {
        const security = operationOf(document, path, method)?.security as
          | Record<string, unknown>[]
          | undefined;

        expect(security?.some((req) => 'access-token' in req) ?? false).toBe(
          isProtected,
        );
      },
    );

    it('names the path parameter public_id on every video endpoint that has one', () => {
      for (const { method, path } of VIDEO_OPERATIONS.filter(({ path: p }) =>
        p.includes('{public_id}'),
      )) {
        const parameters = operationOf(document, path, method)?.parameters as {
          name: string;
          in: string;
        }[];

        expect(parameters).toContainEqual(
          expect.objectContaining({ name: 'public_id', in: 'path' }),
        );
      }
    });

    it('documents the error responses with the shared envelope', () => {
      const expectedErrors: Record<string, string[]> = {
        'post /videos': ['400', '401', '404', '413', '415', '502'],
        'get /videos/{public_id}/upload': ['401', '403', '404', '502'],
        'post /videos/{public_id}/upload/parts': [
          '400',
          '401',
          '403',
          '404',
          '409',
          '502',
        ],
        'post /videos/{public_id}/upload/completion': [
          '401',
          '403',
          '404',
          '409',
          '413',
          '502',
        ],
        'get /videos/{public_id}': ['404', '409'],
        'get /videos/{public_id}/stream': ['404', '409', '416', '502'],
        'get /videos/{public_id}/download': ['404', '409', '502'],
      };

      for (const [key, statuses] of Object.entries(expectedErrors)) {
        const [method, path] = key.split(' ');
        const responses = operationOf(document, path, method)
          ?.responses as Record<
          string,
          { content?: Record<string, { schema?: { $ref?: string } }> }
        >;
        for (const status of statuses) {
          expect(
            responses[status]?.content?.['application/json']?.schema?.$ref,
          ).toBe('#/components/schemas/ApiErrorEnvelope');
        }
      }
    });

    it('documents the partial content response and the Range header of the stream', () => {
      const stream = operationOf(document, '/videos/{public_id}/stream', 'get');

      expect(Object.keys(stream.responses as object)).toEqual(
        expect.arrayContaining(['200', '206', '416']),
      );
      expect(stream.parameters).toContainEqual(
        expect.objectContaining({
          name: 'Range',
          in: 'header',
          required: false,
        }),
      );
    });
  });

  it('exports the same document every time', async () => {
    const again = join(tmpdir(), `openapi-test-again-${Date.now()}.json`);

    await exportSpec(again);

    expect(readFileSync(again, 'utf-8')).toBe(
      readFileSync(outputPath, 'utf-8'),
    );
  }, 30_000);

  describe('versioned openapi.json', () => {
    const versioned = () =>
      JSON.parse(
        readFileSync(join(process.cwd(), 'openapi.json'), 'utf-8'),
      ) as {
        paths: Record<string, unknown>;
        components: { schemas: Record<string, Record<string, unknown>> };
      };

    // `npm run openapi:export` builds with the Nest CLI, which applies the
    // swagger plugin; under ts-jest the DTOs would come out without fields.
    it('describes the video request bodies with the validated fields', () => {
      const { schemas } = versioned().components;

      expect(Object.keys(schemas.CreateVideoDto.properties as object)).toEqual([
        'filename',
        'content_type',
        'size_bytes',
      ]);
      expect(schemas.CreateVideoDto.required).toEqual([
        'filename',
        'content_type',
        'size_bytes',
      ]);
      expect(
        Object.keys(schemas.RequestUploadPartsDto.properties as object),
      ).toEqual(['part_numbers']);
    });

    it('lists the seven video paths', () => {
      expect(Object.keys(versioned().paths)).toEqual(
        expect.arrayContaining([
          '/videos',
          '/videos/{public_id}',
          '/videos/{public_id}/upload',
          '/videos/{public_id}/upload/parts',
          '/videos/{public_id}/upload/completion',
          '/videos/{public_id}/stream',
          '/videos/{public_id}/download',
        ]),
      );
    });
  });
});
