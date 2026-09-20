import { envValidationSchema } from './env.validation';

const requiredEnv = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  STORAGE_ACCESS_KEY_ID: 'access-key',
  STORAGE_SECRET_ACCESS_KEY: 'secret-key',
};

const validate = (env: Record<string, string>) =>
  envValidationSchema.validate(
    { ...requiredEnv, ...env },
    { allowUnknown: true, abortEarly: false },
  );

describe('envValidationSchema — SWAGGER_ENABLED', () => {
  it('should reject SWAGGER_ENABLED with an invalid value', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'invalid' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('SWAGGER_ENABLED');
  });

  it('should accept SWAGGER_ENABLED=true', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'true' });
    expect(error).toBeUndefined();
  });

  it('should accept SWAGGER_ENABLED=false', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'false' });
    expect(error).toBeUndefined();
  });

  it('should apply default false when SWAGGER_ENABLED is not set', () => {
    const result = validate({});
    expect(result.error).toBeUndefined();
    expect((result.value as Record<string, string>).SWAGGER_ENABLED).toBe(
      'false',
    );
  });
});

describe('envValidationSchema — storage', () => {
  it('should reject a missing STORAGE_ACCESS_KEY_ID', () => {
    const { error } = envValidationSchema.validate(
      { ...requiredEnv, STORAGE_ACCESS_KEY_ID: undefined },
      { allowUnknown: true, abortEarly: false },
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('STORAGE_ACCESS_KEY_ID');
  });

  it('should reject a missing STORAGE_SECRET_ACCESS_KEY', () => {
    const { error } = envValidationSchema.validate(
      { ...requiredEnv, STORAGE_SECRET_ACCESS_KEY: undefined },
      { allowUnknown: true, abortEarly: false },
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('STORAGE_SECRET_ACCESS_KEY');
  });

  it('should default the endpoint and buckets to the Compose service names', () => {
    const result = validate({});
    const value = result.value as Record<string, string>;
    expect(result.error).toBeUndefined();
    expect(value.STORAGE_ENDPOINT).toBe('http://minio:9000');
    expect(value.STORAGE_REGION).toBe('us-east-1');
    expect(value.STORAGE_BUCKET_VIDEOS).toBe('videos');
    expect(value.STORAGE_BUCKET_THUMBNAILS).toBe('thumbnails');
  });

  it('should leave STORAGE_PUBLIC_ENDPOINT undefined when not set', () => {
    const result = validate({});
    expect(result.error).toBeUndefined();
    expect(
      (result.value as Record<string, string>).STORAGE_PUBLIC_ENDPOINT,
    ).toBeUndefined();
  });

  it('should accept a valid STORAGE_PUBLIC_ENDPOINT and reject an invalid one', () => {
    expect(
      validate({ STORAGE_PUBLIC_ENDPOINT: 'http://files.example.test:9000' })
        .error,
    ).toBeUndefined();
    const { error } = validate({ STORAGE_PUBLIC_ENDPOINT: 'not a url' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('STORAGE_PUBLIC_ENDPOINT');
  });
});

describe('envValidationSchema — queue and video', () => {
  it('should default the Redis host to the Compose service name', () => {
    const result = validate({});
    const value = result.value as Record<string, unknown>;
    expect(result.error).toBeUndefined();
    expect(value.REDIS_HOST).toBe('redis');
    expect(value.REDIS_PORT).toBe(6379);
  });

  it('should default the video settings', () => {
    const value = validate({}).value as Record<string, unknown>;
    expect(value.VIDEO_UPLOAD_PART_SIZE_BYTES).toBe(67108864);
    expect(value.VIDEO_WORKER_CONCURRENCY).toBe(1);
    expect(value.VIDEO_PROCESSING_TIMEOUT_MS).toBe(1800000);
  });

  it('should reject a part size below the S3 minimum of 5 MiB', () => {
    const { error } = validate({ VIDEO_UPLOAD_PART_SIZE_BYTES: '5242879' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('VIDEO_UPLOAD_PART_SIZE_BYTES');
  });

  it('should accept a part size equal to the S3 minimum', () => {
    expect(
      validate({ VIDEO_UPLOAD_PART_SIZE_BYTES: '5242880' }).error,
    ).toBeUndefined();
  });
});
