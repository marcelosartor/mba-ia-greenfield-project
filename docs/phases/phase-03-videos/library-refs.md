---
libs:
  "bullmq":
    version: "^6.3.8"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-09-20T11:33:09-03:00"
  "@nestjs/bullmq":
    version: "^11.0.5"
    context7_id: "/nestjs/bull"
    fetched_at: "2026-09-20T11:33:09-03:00"
  "@aws-sdk/client-s3":
    version: "^3.1136.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-09-20T11:33:09-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1136.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-09-20T11:33:09-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-09-20T11:31:47-03:00"
---

# Library references — phase-03-videos

Distilled from Context7 for the surfaces used by TD-01 (queue), TD-02 and TD-09 (storage). Versions are the ranges recorded in the decisions doc, checked against the npm registry on 2026-09-20. Node runtime image: `node:25.6.0-slim`; project is CommonJS (`module: nodenext`, no `"type": "module"`) with Jest 30 + ts-jest.

### bullmq

**Version:** `^6.3.8` (registry: dual package, `main` = `./dist/cjs/index.js`, `module` = `./dist/esm/index.js`; safe to `require` from this CommonJS project).

- **Adding jobs with retries.** `queue.add(name, data, { attempts, backoff, jobId, removeOnFail })`. Exponential backoff: `backoff: { type: 'exponential', delay: 1000 }` with `attempts: 3`.
- **Idempotent publish.** A job added with a custom `jobId` that already exists is not duplicated: the add script checks the job key and returns the existing id (emitting a `duplicated` event). This is what makes re-publishing with `jobId = videoId` (TD-01, TD-03) safe. A separate `deduplication: { id, ttl }` option also exists.
- **Non-retryable failure.** Throwing `UnrecoverableError` from the processor moves the job straight to the failed set, bypassing the remaining `attempts` (TD-08).
- **Failed-job retention (manual DLQ pattern).** `removeOnFail: { age, count }` on the worker/job controls how long failed jobs stay inspectable; BullMQ has no built-in dead-letter queue, so TD-08 publishes to a `…-dlq` queue from the `failed` event handler.
- **Scheduled jobs (TD-03 sweeper).** `queue.upsertJobScheduler(schedulerId, { every: <ms> } | { pattern: '<cron>' }, { name, data, opts })` creates or updates a repeatable job; a `Worker` on the same queue processes it. This replaces the legacy repeatable-jobs API.
- **Worker.** `new Worker(queueName, processor, { connection, concurrency, lockDuration })`. A worker's Redis connection needs `maxRetriesPerRequest: null` when you supply your own ioredis instance (the docs' reuse example). `lockDuration` is the lock TTL (renewed while the processor is alive); the docs' example sets it to `60000`.
- **Graceful shutdown.** On `SIGINT`/`SIGTERM` call `await worker.close()` before exiting so active jobs finish and are not marked stalled.
- **Production requirements.** Redis must use `maxmemory-policy noeviction` and AOF persistence (per BullMQ's going-to-production guide; the library warns at runtime on another eviction policy). Applies to the `redis` Compose service (TD-01).

### @nestjs/bullmq

**Version:** `^11.0.5` — pinned on purpose. Registry check (2026-09-20): `@nestjs/bullmq@11.0.5` is CommonJS, peers `bullmq ^3 || ^4 || ^5 || ^6` and `@nestjs/common/@nestjs/core ^10 || ^11`. `@nestjs/bullmq@12.0.0` declares `"type": "module"` (ESM-only) and must not be used in this CommonJS + Jest project (TD-01 Revision).

- **Root configuration.** `BullModule.forRootAsync({ imports: [ConfigModule], inject: [...], useFactory: (...) => ({ connection: { host, port, password } }) })`. The docs example injects `ConfigService`; this project injects namespaced `registerAs` configs through `ConfigType`/`@Inject(xxxConfig.KEY)` (Phase 01 convention), so the factory should read a `redis`/queue config namespace, with the host being the Compose service name.
- **Queues.** `BullModule.registerQueue({ name: 'video-processing' })` makes the queue injectable with `@InjectQueue('video-processing')` (used by the API to publish and by the sweeper).
- **Processors.** `@Processor('video-processing')` on a class extending `WorkerHost`, implementing `process(job)`. Throwing from `process` lets BullMQ apply `attempts`/`backoff`.
- **Worker events.** `@OnWorkerEvent('failed' | 'error' | 'stalled' | 'closed' | ...)` handlers on the processor class; the `failed` handler is where the DLQ publish (TD-08) lives.
- **Module wiring.** Every module that uses `registerQueue` needs a module compilation test (project testing guide: DI wiring), and queue tests run against the real Redis service in Compose.

### @aws-sdk/client-s3

**Version:** `^3.1136.0` (registry: `main` = `./dist-cjs/index.js`; requires Node ≥ 20).

- **Client for MinIO.** `new S3Client({ endpoint, forcePathStyle: true, region, credentials: { accessKeyId, secretAccessKey } })`. `forcePathStyle` keeps the bucket in the URL path, required for a Compose hostname such as `http://minio:9000` (TD-09). Endpoint and credentials come from environment configuration, never `localhost`.
- **Multipart upload (TD-02).** `CreateMultipartUploadCommand({ Bucket, Key, ContentType, ... })` returns `UploadId`. `UploadPartCommand({ Bucket, Key, UploadId, PartNumber, ... })`; `PartNumber` is 1–10000; the response carries the part `ETag`. `CompleteMultipartUploadCommand({ Bucket, Key, UploadId, MultipartUpload })` with the completed parts. In TD-02 the client sends the parts straight to storage through presigned URLs, and the API completes the upload after listing the parts itself.
- **Not returned by Context7 in this run (confirm against the generated command types at implementation):** the exact `ListPartsCommand` request/response fields (pagination markers, `Parts`, `IsTruncated`), the `Parts: [{ ETag, PartNumber }]` element shape inside `CompleteMultipartUpload`'s `MultipartUpload`, and `AbortMultipartUploadCommand`. The excerpt returned only shows `MultipartUpload?: CompletedMultipartUpload`.
- **Ranged reads (TD-07).** `GetObjectCommand({ Bucket, Key, Range: 'bytes=0-9' })` responds with `ContentLength: 10`, `ContentRange: 'bytes 0-9/43'`, `AcceptRanges: 'bytes'`, `ETag`, `ContentType`, and `Body` as a streaming payload. The body stream must be consumed or destroyed (`Body.destroy()` on Node) to free the socket. `ResponseContentDisposition` can set a download filename on a presigned GET.

### @aws-sdk/s3-request-presigner

**Version:** `^3.1136.0` (registry: `main` = `./dist-cjs/index.js`).

- **Presigning.** `getSignedUrl(client, new UploadPartCommand({ Bucket, Key, UploadId, PartNumber }), { expiresIn })` and the same for `GetObjectCommand`. `expiresIn` defaults to 900 s; TD-02 sets 3600 s for part URLs.
- **Signed headers.** To sign `x-amz-*` headers (for example a checksum header), pass them in `unhoistableHeaders` so they are required on the upload request.
- **Host binding.** The presigner signs with the client's configured endpoint; the URL is valid only for that host (TD-09: Compose service host in Phase 03; a separate browser-reachable signing client only when a frontend uploads).
