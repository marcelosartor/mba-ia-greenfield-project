---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-09-20
scope_description: "Backend and infrastructure for video upload and processing: queue technology, direct-to-storage 10GB upload, abandoned-upload cleanup, worker packaging, media extraction, public video identifier, streaming/download delivery, status lifecycle with failure handling, storage layout, and MinIO distribution."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — hosts everything in this phase: the videos module and upload/stream endpoints (API), the video worker (second entrypoint in the same package, see TD-04), the `videos` migration, and the `compose.yaml` additions (object storage, Redis queue, `minio-init`, and the worker service).
- `next-frontend/` — not initialized, and Phase 03 has no UI (PRD 02 and PRD 05 put upload screen and player out of scope). The client-side handshakes fixed by TD-02 (upload) and TD-07 (streaming/download) are consumed in Phases 04–05. No open decision for this subproject in this document.

**Sources of requirements:** `docs/project-plan.md` (Phase 03 bullets, quoted literally in each `Capability:`) and the six PRDs in `docs/prd/` (cited as PRD 01–06 in each Context). **Inherited decisions (not reopened):** custom JWT guards with a global guard + `@Public()`, `DomainException` filter for error responses, class-validator DTOs, Joi env validation with `registerAs` config namespaces, `@nestjs/throttler` (`technical-decisions-phase-02-auth.md`, `technical-decisions-phase-01-configuracao-base.md`).

**Installed stack (checked):** NestJS 11, TypeORM 0.3.28, `pg` 8.20, PostgreSQL 17, Node 25.6 container on Debian 12 (bookworm), CommonJS output (`module: nodenext`, no `"type": "module"`), Jest 30 + ts-jest. No Redis, object storage, or queue in `compose.yaml` today.

---

## TD-01: Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The project plan leaves the queue open ("Message Queue — TBD") and PRD 01 lists it as the main gap. The API publishes one job per uploaded video (PRD 03 req. 1) and a separate worker consumes it (req. 2). Jobs are few but long-running (probing/thumbnailing a source of up to 10GB), must survive restarts, need bounded retries and a place for permanently failed jobs (PRD 03 gaps), and must not be lost between "video row updated" and "job published". The enunciado adds a hard constraint: `compose.yaml` must gain object storage, **queue** and worker services, and "não ter fila, worker e storage reais subindo no Compose" is an automatic-fail criterion. Decision affects the API, the worker, `compose.yaml`, `.env.example`, and the integration-test setup (PRD 01: real services, no mocks).

**Options:**

### Option A: pg-boss 11.x on the existing PostgreSQL
- Jobs live in a library-managed `pgboss` schema. `send()` accepts a `db` option, so "update video + enqueue" can run in the caller's transaction (atomic, no outbox). Native `retryLimit`/`retryBackoff`, queue-level `deadLetter` queue, per-job `expireInSeconds`, cron `schedule()`.
- **Pros:** no new stateful service; atomic enqueue removes the DB/queue dual-write problem; job state is queryable with SQL; DLQ and retry built in; cron scheduling reusable by TD-03.
- **Cons:** no first-class Nest module (thin provider needed); the library owns its own schema/migrations outside TypeORM migrations; polling load on the primary DB (negligible at this volume); job timeout (`expireInSeconds`) must be sized above worst-case processing; **pin major 11** — v12 is ESM-only (`exports: ./dist/index.mjs`, Node ≥22.12) while this project is CommonJS + Jest/ts-jest. **No queue service is added to `compose.yaml`** (the queue is tables inside the existing `db` service), which conflicts with PRD 01 requirement 2 and is exactly what the enunciado's deliverable and automatic-fail line ask to see as a running Compose service.

### Option B: BullMQ 6 + `@nestjs/bullmq` on Redis
- First-class Nest integration (`@Processor`, `WorkerHost`, `registerQueue`). `attempts` + `backoff`, `jobId` de-duplication, stalled-job recovery with lock renewal, `removeOnFail` retention (failed jobs stay inspectable; a dedicated DLQ is a manual pattern). Peers accept Nest 11 (`@nestjs/bullmq` 11.0.5 and 12.0.0 both list `@nestjs/common ^11`).
- **Pros:** best Nest ecosystem/docs (the official queues recipe); mature, dashboards available (Bull Board); lock renewal suits long jobs; CJS-compatible; a real `redis` Compose service with its own healthcheck, as the enunciado's compose deliverable expects; Redis becomes reusable later (rate-limit store, view counters, cache).
- **Cons:** new stateful service to run, secure and health-check; docs require Redis with AOF persistence and `maxmemory-policy noeviction`; enqueue is not atomic with the DB commit (needs enqueue-after-commit plus a reconciliation sweeper keyed by an idempotent `jobId`); no built-in DLQ.

### Option C: RabbitMQ (quorum queues) via `amqplib`
- Broker-native at-least-once delivery, dead-letter exchange and `delivery-limit` policy for poison messages; routing topologies for future consumers.
- **Pros:** strongest delivery semantics; real DLX; decouples producers/consumers cleanly.
- **Cons:** heaviest service (Erlang broker + management plugin); no Nest job abstraction (retry/backoff/delay topology must be built via TTL + DLX); un-acked deliveries are bound to `consumer_timeout` (default 1,800,000 ms = 30 min), which long jobs must be tuned around; same dual-write gap as B.

**Recommendation:** **Option B (BullMQ 6 + `@nestjs/bullmq` on Redis)** — it delivers the queue as a real Compose service, which the enunciado and PRD 01 require and whose absence is an automatic-fail item, and it has the strongest Nest integration (the official queues recipe, CJS-compatible, no ESM friction with Jest). The costs are operating Redis (AOF persistence and `noeviction` per the BullMQ docs) and the lack of atomic enqueue: publish right after the DB commit with `jobId = videoId`, and let the TD-03 sweeper re-enqueue videos whose upload completed but never left `draft` (the fixed `jobId` makes re-publishing idempotent). A dedicated DLQ is a small manual addition (TD-08). **Trade-off acknowledged:** pg-boss 11.x is technically the tighter fit for a Postgres-centred system (atomic enqueue, native DLQ, no new service), and is the better choice if a queue living inside the `db` service is acceptable to whoever grades the Compose deliverable; this document does not assume it is.

**Decision:** B (BullMQ 6 + `@nestjs/bullmq` on a Redis Compose service)
**Libraries:** bullmq@^6.3.8, @nestjs/bullmq@^11.0.5

**Revisions:**
- 2026-09-20 — `@nestjs/bullmq` pinned to `^11.0.5`, not 12.x. Rationale: @nestjs/bullmq 12.0.0 is ESM-only (`"type": "module"`) while the project is CommonJS + Jest/ts-jest; 11.0.5 is CommonJS and accepts bullmq 6 and NestJS 11 (registry check, 2026-09-20).

---

## TD-02: Upload Protocol and Completion Detection

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance; Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Context:** PRD 02: video bytes must not pass through the API process (doing so is an automatic failure), up to 10GB, draft row created when the upload starts and bound to the authenticated user's channel, and the system must learn when the upload ends to trigger processing (PRD 02 req. 6). The project plan adds that the upload must be **resumable** after a connection failure (Pontos de Atenção). Backend impact: endpoints, storage calls, draft row. Frontend impact (future): file slicing, parallel part PUTs, resume flow. Storage limits (MinIO docs): parts 5 MiB–5 GiB, max 10,000 parts per upload. Depends on TD-09 (which host the presigned URLs are signed for).

**Options:**

### Option A: Single presigned PUT
- API creates the draft and returns one presigned URL; the client PUTs the whole file.
- **Pros:** simplest handshake on both sides; one signed request.
- **Cons:** not resumable (violates the plan's resume requirement); one 10GB request; real S3 caps a single PUT at 5 GiB (MinIO documents 5 TiB), so it breaks S3 portability; completion known only by client callback or a storage event.

### Option B: Presigned multipart upload, API-orchestrated
- `POST` init: API validates size/type, creates the draft, calls `CreateMultipartUpload`, stores `upload_id`/key, returns part size. Client requests presigned `UploadPart` URLs (in batches) and PUTs parts straight to storage, in parallel and retryable per part. Client calls `complete`; API lists parts (`ListParts`), validates count and total size, then calls `CompleteMultipartUpload` and enqueues processing. Resume = `ListParts` shows what already exists.
- **Pros:** resumable, parallel, per-part retry; S3-portable; bytes never touch the API; because the API reads `ListParts` itself, part ETags never need to reach the client (no CORS `ExposeHeaders: ETag` requirement).
- **Cons:** three-step handshake on both sides; client must slice files; abandoned uploads leave parts (TD-03); a presigned URL is valid only for the host it was signed for, so the Compose service host works in this phase (tests and the 10GB proof run inside Docker) and a browser-reachable host is needed once a frontend uploads (TD-09).

### Option C: tus resumable-upload protocol (tus server with S3 store)
- Standard resumable protocol with mature client libraries; a tus server writes to storage.
- **Pros:** off-the-shelf client/server semantics for resume.
- **Cons:** bytes flow through the tus server process — inside the API it violates PRD 02; as a separate container it is a new service and protocol to run; less aligned with plain S3 semantics.

**Recommendation:** **Option B (multipart, API-orchestrated)** — it is the only option that meets both the "not through the API" rule and the plan's resume requirement while staying portable to real S3. Completion detection is an explicit client `complete` call: `CompleteMultipartUpload` must be invoked by someone anyway and the API is the natural caller, so storage-event webhooks (endpoint, auth, event-loss handling) would add moving parts for no gain. Parameters: server-fixed part size 64 MiB (10 GiB → 160 parts, far below the 10,000 cap), presigned part URLs valid for 1 h, size limit 10 GiB validated at init and re-checked from `ListParts` before completing, file extension/MIME allowlist at init (mp4, mov, mkv, webm — the authoritative validity check is ffprobe in TD-05), initial draft title derived from the file name, channel taken from the authenticated user, never from the request body. Per the project's REST conventions (plural resource nouns, correct methods and status codes) the handshake is modelled as resources, not verbs: creating the draft and its upload session is `POST` on the videos collection, part URLs and the completion request are sub-resources of that video's upload; the exact paths are fixed in the plan.

**Decision:** B (Presigned multipart upload, API-orchestrated; completion by explicit client `complete` call)
**Libraries:** @aws-sdk/client-s3@^3.1136.0, @aws-sdk/s3-request-presigner@^3.1136.0

---

## TD-03: Abandoned Upload and Orphan Draft Cleanup

**Scope:** Backend

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance; Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Context:** PRD 02 gap: what happens to uploads that never complete. With TD-02 B, an abandoned upload leaves stored parts (up to ~10GB each, billed and invisible in listings) and a draft row without a file. The plan's Pontos de Atenção calls out storage growth and cost. Cross-component: DB rows, storage multipart state, and the scheduler. Depends on TD-01 for scheduling.

**Options:**

### Option A: Storage lifecycle rule (`AbortIncompleteMultipartUpload`)
- Bucket rule aborts multipart uploads older than N days; zero application code.
- **Pros:** no code; standard S3 practice.
- **Cons:** the MinIO docs consulted state the action is **not supported** through `PutBucketLifecycle` (validate in a spike on the pinned image, TD-10); it never removes the orphan draft row.

### Option B: Scheduled sweeper job
- A cron-scheduled job finds drafts whose upload was never completed and are older than 24 h, calls `AbortMultipartUpload`, and removes (or marks) the draft. Also runs against the storage's own multipart listing to catch parts with no row, and re-enqueues videos whose upload completed but whose processing job was never published (TD-01).
- **Pros:** works on MinIO and S3; cleans DB and storage together; testable with real services.
- **Cons:** application code and a retention threshold to maintain; needs the scheduler from TD-01 (BullMQ job scheduler / repeatable job; pg-boss `schedule()` if that option is chosen).

### Option C: No cleanup in this phase
- Document the leak as known debt.
- **Pros:** zero code.
- **Cons:** partial 10GB uploads accumulate silently; contradicts the plan's storage-cost concern.

**Recommendation:** **Option B** — Option A does not work on the target storage per its documentation and would leave rows behind anyway; keep it as a belt-and-braces addition if the deployment later moves to real S3. Threshold: 24 h without completion.

**Decision:** B (Scheduled sweeper job, 24 h threshold; also re-enqueues completed uploads whose job was never published)

---

## TD-04: Worker Placement and Packaging

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas); Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** PRD 01 gaps: where the worker code lives and how it is packaged; PRD 01 req. 3–4: separate container/process from the API with FFmpeg/ffprobe available at runtime. The worker needs the `Video` entity, DB config, storage and queue modules. The Definition of Done (`tsc`, lint, full suite) applies to whatever is added.

**Options:**

### Option A: Same package, second entrypoint
- `nestjs-project/src/worker.ts` bootstraps a Nest standalone application context (`NestFactory.createApplicationContext`) with a dedicated `WorkerModule` (DB, storage, queue, processor — no HTTP). A `video-worker` compose service runs `node dist/worker` from the same codebase on `docker compose up`; API and worker share the same dev image, which includes `ffmpeg`.
- **Pros:** one `Video` entity/config/migration source; one lockfile and one tsc/lint/test pipeline; no cross-package drift; real-FFmpeg tests run inside `nestjs-api`, where CLAUDE.md requires every test command to run.
- **Cons:** deploy coupling with the API; the shared dev image carries FFmpeg for the API too (there is no production Dockerfile yet, so slimming the API image is deferred); discipline to keep HTTP modules out of `WorkerModule`.

### Option B: Separate subproject (`video-worker/`)
- Own `package.json`, Dockerfile and test setup.
- **Pros:** strict isolation; smaller independent image; independent scaling/versioning.
- **Cons:** duplicates or must share entities and config (no workspace/shared-package tooling exists); second lockfile/lint/tsc/test setup and a second DoD; risk of `videos` table drift between two definitions.

### Option C: Nest monorepo mode (`apps/` + `libs/`)
- Official mechanism for multiple apps sharing libraries.
- **Pros:** first-party support for shared libs.
- **Cons:** restructures the existing `src/` layout and every path referenced by configs, CLAUDE.md and tests; a refactor that should not be mixed into this phase (scope limits).

**Recommendation:** **Option A** — the worker's whole job is to mutate the same `videos` rows the API creates, so sharing entity, config and DoD pipeline outweighs the isolation benefits of B at this scale; C is a layout refactor outside this phase's scope. Install FFmpeg in the shared `Dockerfile.dev` so the real-FFmpeg integration tests (PRD 03) run inside `nestjs-api`, and start the worker process on `docker compose up`.

**Decision:** A (Same package, second entrypoint; FFmpeg in the shared `Dockerfile.dev`; the worker service runs its process on `up`)

**Note:** Revised after checking the repository structure in CLAUDE.md, which defines two areas (`nestjs-project/` and `next-frontend/`): the worker stays inside `nestjs-project/`, so no new subproject is created. It reuses the `Video` entity, the `registerAs` + Joi configuration, the `DomainException` conventions and the single DoD pipeline (`tsc`, lint, full suite) inherited from Phases 01–02. Two CLAUDE.md interactions are resolved in favour of the enunciado's binding rules: (1) every test command keeps running in the `nestjs-api` container, so FFmpeg lives in the shared dev image instead of a worker-only image; (2) `nestjs-project/CLAUDE.md` says starting the environment means infrastructure only and never the NestJS application server, while the enunciado requires a real worker running in Compose (automatic-fail line "não ter fila, worker e storage reais subindo no Compose"), so at closing (PRD 06) that startup rule is adjusted minimally to treat the worker as infrastructure — it still applies to the API dev server.

---

## TD-05: Media Extraction and Thumbnail Generation

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** PRD 03 gaps: how metadata is extracted, which frame becomes the thumbnail, and which metadata fields are persisted. The source can be up to 10GB. `fluent-ffmpeg` is excluded: the npm registry marks it "Package no longer supported". Runs in the worker (TD-04) and reads/writes storage (TD-09). Debian 12 provides FFmpeg via apt.

**Options:**

### Option A: Spawn `ffprobe`/`ffmpeg` directly, reading the source over a presigned GET URL
- `execFile` with `ffprobe -print_format json -show_format -show_streams <url>` and `ffmpeg -ss <t> -i <url> -frames:v 1 … out.jpg`, with a timeout and abort signal; FFmpeg uses HTTP range requests, so no local copy of the source.
- **Pros:** no 10GB temp disk; no deprecated wrapper; few dependencies; easy to kill on timeout.
- **Cons:** MP4 files with the index (moov atom) at the end cost extra range requests; a mid-processing network failure retries the whole job; the presigned URL must be resolvable from the worker (internal endpoint).

### Option B: Download the object to a worker temp volume, then process locally
- Stream the object to disk, run ffprobe/ffmpeg on the file, delete afterward.
- **Pros:** deterministic seeking; independent of network during the FFmpeg run.
- **Cons:** needs up to 10GB of scratch space per concurrent job and transfer time before any output; cleanup on crash; volume sizing in compose.

**Recommendation:** **Option A**, falling back to B only if remote probing fails for a file (recorded as a retryable error, TD-08). Thumbnail frame at `min(10% of duration, 10 s)`, JPEG scaled to 640 px wide preserving aspect ratio, stored at a deterministic key so retries overwrite. Persisted metadata: `duration_seconds`, `width`, `height`, `video_codec`, `audio_codec`, `bit_rate`, `format_name`, `size_bytes` as columns, plus a `metadata` JSONB with the trimmed ffprobe output. An input that ffprobe cannot parse is a non-retryable failure (TD-08).

**Decision:** A (Spawn `ffprobe`/`ffmpeg` directly, reading the source over a presigned GET URL)

---

## TD-06: Public Video Identifier (Unique URL)

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** PRD 04: identifier assigned at pre-registration, unique by DB constraint, collision-free under concurrent creation, stable across processing, and used to resolve public endpoints. The plan asks for a "URL curta e única" (Pontos de Atenção). Existing tables use `uuid` primary keys (`uuid_generate_v4()`). PRD 04 gap: format, collision handling, and whether it equals the PK.

**Options:**

### Option A: Expose the primary-key UUID
- The URL uses `videos.id`.
- **Pros:** no extra column; uniqueness inherited from the PK.
- **Cons:** 36 characters, not short; couples the public URL to the internal key.

### Option B: Separate `public_id` column with a short random value
- 11 characters from a URL-safe alphabet (≈2^66 space) generated with `crypto.randomBytes` (no new dependency), `UNIQUE` index; on unique violation (SQLSTATE `23505`) the insert is retried a few times. Never updated after insert.
- **Pros:** short and unguessable; the DB constraint is the arbiter under concurrency; decoupled from the PK; stable by construction.
- **Cons:** extra column and a retry path (collision is negligible but handled).

### Option C: Encoded sequential id (Sqids/Hashids over a bigint sequence)
- Collision-free by construction; short.
- **Pros:** no collision handling.
- **Cons:** needs a bigint sequence alongside UUID PKs; enumerable if the salt leaks; extra dependency.

**Recommendation:** **Option B** — short, unguessable, race-safe through the unique constraint the PRD already requires, and independent of the internal PK. Generate with `crypto` rather than `nanoid` (v5 is ESM-only in this CommonJS project). Storage keys use the internal UUID (TD-09), so the public identifier can stay purely a URL concern.

**Decision:** B (Separate `public_id` column, 11-char random value, unique index with retry on collision)

---

## TD-07: Streaming and Download Delivery

**Scope:** Cross-layer

**Capability:** Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

**Context:** PRD 05: `Range` requests get `206` with the requested slice, requests without `Range` must not buffer the whole file in the API, download returns the complete file, and non-`ready` videos are not served. Anonymous visitors watch freely, but visibility (public/unlisted) only arrives in Phase 04. Backend impact: endpoint and storage read. Frontend impact (future): `<video src>` issues Range requests natively; download is a link. The architecture diagram draws `Frontend → Storage: Streams`, which Option A deviates from. Depends on TD-06 (resolution by public id) and TD-09 (endpoints).

**Options:**

### Option A: API proxy with Range pass-through
- `GET` stream endpoint checks the video is `ready`, forwards the `Range` header to `GetObject`, answers `206` with `Content-Range`/`Accept-Ranges`/`Content-Length`, and pipes the storage stream to the response with backpressure (no buffering). Download uses the same read with `Content-Disposition: attachment`.
- **Pros:** the PRD acceptance tests hit the API literally (`Range: bytes=0-1023` → `206`, 1024 bytes); status and future visibility are checked on every request; storage host never exposed for reads.
- **Cons:** video bytes traverse the API process (CPU/bandwidth on the API, scaled horizontally if needed); departs from the diagram arrow.

### Option B: API answers `302` to a short-lived presigned GET URL
- Storage serves Range natively; download adds `response-content-disposition=attachment`. TTL of 5–15 minutes.
- **Pros:** API out of the data path; scales with storage; matches the diagram.
- **Cons:** a leaked URL bypasses later visibility changes until it expires; requires a browser-reachable storage endpoint for reads too (TD-09); the `206` test must follow the redirect to storage.

**Recommendation:** **Option A** for Phase 03 — it satisfies the acceptance criteria as written, keeps authorization per request (Phase 04's visibility rules take effect immediately), and keeps the streaming logic behind one service so a later switch to B does not change the public endpoint. Endpoints are `@Public()` for `ready` videos only; any other status returns a domain error (unknown → not found, not ready → conflict). **Open point:** until Phase 04 adds publication gating, any `ready` video is reachable by anyone holding its unguessable public id (TD-06), i.e. it behaves like "unlisted"; confirm this is acceptable for the phase.

**Decision:** A (API proxy with Range pass-through). Open point resolved: until Phase 04 adds publication gating, stream and download endpoints are `@Public()` for any `ready` video (unlisted-like, reachable by anyone holding the public id); Phase 04 must add the block for unpublished videos.

**Note:** The root CLAUDE.md ("Frontend … streams from Object Storage", "API … uploads to storage") and `docs/diagrams/software-arch.mermaid` (`Frontend → Storage: Streams`, `API → Storage: Uploads`, `Message Queue: TBD`) describe the target architecture, which the enunciado leaves to this research (lines on streaming/upload decisions) and requires to match the code at the end (documentation inconsistent with the code is an automatic-fail item). At closing (PRD 06) they are updated to the implemented flow: the client uploads parts directly to storage (TD-02), the API streams and serves downloads (this TD), and the queue is BullMQ on Redis (TD-01). Streaming endpoints are modelled as REST resources of the video (the exact paths are fixed in the plan).

---

## TD-08: Video Status Lifecycle, Failure Handling and Idempotency

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados); Pré-cadastro automático do vídeo como rascunho ao iniciar o upload; Serviço de processamento em segundo plano (filas)

**Context:** PRD 03: status follows draft → processing → ready | error, reflected in the DB on each transition, with the failure cause, retry policy, DLQ, job idempotency and invalid transitions left to research. The status enum and its transition table are shared by the API (creates the draft, triggers processing), the worker (moves to processing/ready/error) and the DB (check constraint) — a cross-component invariant. Depends on TD-01 (retry/DLQ primitives) and TD-05 (which errors exist).

**Options:**

### Option A: Classified errors, bounded retries, DLQ, compare-and-set transitions
- Transient failures (storage, network, DB) retry with exponential backoff, limit 3; non-retryable failures (unparseable/corrupt media) go straight to `error`. After retries are exhausted the job is moved to a dead-letter queue (native `deadLetter` in pg-boss; with BullMQ a small `failed`-event handler that publishes to a `…-dlq` queue) and the video becomes `error` with `error_code` and a short `error_message`. Job payload is only `{videoId}`; the job is de-duplicated per video; every transition is a conditional `UPDATE … WHERE id = $1 AND status = <expected>`; an already-`ready` video makes the job a no-op; the thumbnail key is deterministic so re-runs overwrite.
- **Pros:** separates a bad file from an infrastructure blip; bounded cost for 10GB reads; observable DLQ; idempotent under redelivery.
- **Cons:** error classification must be maintained; two writers of `error` (worker and DLQ handler).

### Option B: Uniform retries, no classification
- Any failure retries N times, then `error`.
- **Pros:** simplest.
- **Cons:** wastes retries (and large reads) on files that can never succeed.

### Option C: No retries
- Any failure sets `error` immediately; the user re-uploads.
- **Pros:** least code.
- **Cons:** a transient blip permanently fails a video after a possibly hours-long 10GB upload.

**Recommendation:** **Option A** — the CAS transitions are also the answer to invalid transitions (rejected, surfaced as a domain error on the API side) and to idempotency under at-least-once delivery. Status values: `draft` (created, upload not yet completed), `processing`, `ready`, `error`, with a check constraint. **Dependency to note:** Phase 04 introduces a "rascunho → publicação" flow; keep publication/visibility as separate columns rather than overloading this processing status. **Convention interaction:** the service rule for background tasks ("log the error, do not rethrow") targets fire-and-forget handlers and cron jobs; a BullMQ processor must throw for `attempts`/`backoff` to apply, so retryable errors are thrown from the processor, while non-retryable ones are raised as BullMQ's `UnrecoverableError`, which the BullMQ docs describe as moving the job straight to the failed set and bypassing the remaining attempts.

**Decision:** A (Classified errors, bounded retries — limit 3 with exponential backoff, DLQ, compare-and-set transitions)

**Revisions:**
- 2026-09-20 — `videos` gains an `upload_completed_at` column and status `draft` covers both cases: null means the upload is still in progress, set means the upload completed and the video awaits the worker. The TD-03 sweeper aborts drafts whose `upload_completed_at` is null after 24 h and re-enqueues those where it is set; the completion request is idempotent (a repeated call sees the marker); abandoned drafts are removed, so the status enum stays `draft`, `processing`, `ready`, `error`. Rationale: Tornar a conclusão idempotente sob retry do cliente.

---

## TD-09: Bucket and Key Layout and Storage Access

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** PRD 01: buckets exist right after `docker compose up` without manual steps (req. 6), and API and worker reach storage through the Compose service name (req. 5). PRD 01 gap: one bucket or two, and key prefixes. Cross-component: API, worker, `compose.yaml`, `.env.example` and Joi validation must agree on names. Client libraries: `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` (both 3.1136.0 in the registry, Node ≥20).

**Options:**

### Option A: Two buckets
- `videos` (originals, private) with keys `{channelId}/{videoId}/source.{ext}`; `thumbnails` with keys `{videoId}/default.jpg`.
- **Pros:** separate policies, lifecycle and future CDN/caching per content type; blast radius split.
- **Cons:** two buckets to provision and configure.

### Option B: One bucket with prefixes
- `streamtube` bucket with `videos/…` and `thumbnails/…` prefixes.
- **Pros:** one bucket to provision; one env var.
- **Cons:** policies and lifecycle only by prefix; shared blast radius.

**Recommendation:** **Option A** — thumbnails will need different access and caching than originals (home grid in Phase 07), so separating them now avoids a later data move. Keys use the internal UUID, never the public id (TD-06). Buckets are created by a `minio-init` Compose service (MinIO client, idempotent "make bucket if missing"), with API and worker waiting on its successful completion. Use `forcePathStyle` and the Compose service host (`http://minio:9000`) for all traffic, including presigning: in Phase 03 there is no browser client, and tests plus the manual 10GB proof run inside the Docker network, so the "always the Compose service name, never `localhost`" rule holds with no exception. **Deferred, to be recorded rather than solved now:** a presigned URL is valid only for the host it was signed for (the signature covers `Host`), so when the frontend uploads from a browser a separate, browser-reachable signing endpoint (an optional `STORAGE_PUBLIC_ENDPOINT`, unset by default) and MinIO CORS for the PUT origin will be needed; that belongs to the frontend phase. Application code reaches storage through a `StorageService` abstraction (the pattern the project's testing guide recommends), and its tests run against the real MinIO service in Compose: the enunciado and PRD 01 require real infrastructure, which supersedes the guide's local-filesystem note for storage. New environment keys (storage endpoint, credentials, bucket names, Redis host) are required or default to Compose service names, never `localhost`; the existing `DB_HOST` and `APP_URL` defaults in `env.validation.ts` are not a pattern to copy.

**Decision:** A (Two buckets `videos` and `thumbnails`; buckets created by a `minio-init` Compose service; Compose service host only in this phase)
**Libraries:** @aws-sdk/client-s3@^3.1136.0, @aws-sdk/s3-request-presigner@^3.1136.0

---

## TD-10: MinIO Distribution (Image Source and Pinning)

**Scope:** Repo-wide

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** The storage is given (S3/MinIO), but how to obtain it changed. Verified in this session: `minio/minio` (`latest` and the last release tag) can no longer be found on Docker Hub, while `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` and `quay.io/minio/mc:latest` still resolve. Web sources report the community edition in maintenance mode since December 2025 with no new images or binaries, and a critical vulnerability disclosed around October 2025. Affects `compose.yaml` and any doc that says "MinIO". Local development and tests only; not for production exposure.

**Options:**

### Option A: Pin the last community image from `quay.io`
- `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` (and a pinned `mc`), never `latest`.
- **Pros:** works today; matches the enunciado and PRDs; the app only speaks the S3 API.
- **Cons:** frozen and unpatched; the registry could remove it too; must stay on local networks.

### Option B: Build MinIO from source in a Dockerfile
- Multi-stage build compiling a pinned tag.
- **Pros:** still MinIO; not dependent on a registry keeping images.
- **Cons:** build time and Go toolchain in the repo; upstream is in maintenance mode.

### Option C: S3-compatible alternative (Garage, SeaweedFS, RustFS, …)
- Same S3 client code, different server image.
- **Pros:** actively developed options exist.
- **Cons:** departs from the enunciado's "S3/MinIO"; multipart, presign, CORS and lifecycle behavior must be re-validated per server; not evaluated here.

**Recommendation:** **Option A** for development and tests, plus two guardrails: application code stays strictly S3-API with endpoints/credentials from env (so C becomes a config swap), and the known limitation is recorded in the docs and CLAUDE.md. Revisit if the pinned image disappears or the project moves toward deployment.

**Decision:** A (Pin the last community image from `quay.io`, never `latest`; development and tests only)

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Queue Technology | B (BullMQ 6 + `@nestjs/bullmq` on a Redis Compose service); A (pg-boss 11.x) as alternative | B (BullMQ + Redis) |
| TD-02 | Cross-layer | Upload Protocol and Completion Detection | B (presigned multipart, API-orchestrated, client `complete` call) | B (presigned multipart) |
| TD-03 | Backend | Abandoned Upload and Orphan Draft Cleanup | B (scheduled sweeper, 24 h) | B (scheduled sweeper) |
| TD-04 | Backend | Worker Placement and Packaging | A (same package, second entrypoint, FFmpeg in the shared dev image) | A (same package, second entrypoint; worker runs on `up`; FFmpeg in shared dev image) |
| TD-05 | Backend | Media Extraction and Thumbnail Generation | A (spawn ffprobe/ffmpeg over presigned URL) | A (spawn over presigned URL) |
| TD-06 | Backend | Public Video Identifier (Unique URL) | B (`public_id`, 11-char random, unique index + retry) | B (`public_id`) |
| TD-07 | Cross-layer | Streaming and Download Delivery | A (API proxy with Range pass-through) | A (API proxy; public for any `ready`) |
| TD-08 | Backend | Video Status Lifecycle, Failure Handling and Idempotency | A (classified errors, bounded retries, DLQ, CAS transitions) | A |
| TD-09 | Backend | Bucket and Key Layout and Storage Access | A (two buckets, `minio-init`, Compose service host only in this phase) | A |
| TD-10 | Repo-wide | MinIO Distribution (Image Source and Pinning) | A (pin `quay.io/minio/minio` last community release) | A |

## Notes for the Reviewer

- **Findings that change the plan:** (1) `minio/minio` is gone from Docker Hub (TD-10); (2) MinIO docs list `AbortIncompleteMultipartUpload` as unsupported through `PutBucketLifecycle` (TD-03); (3) `pg-boss@12` is ESM-only in a CommonJS + Jest project (TD-01; only matters if Option A is chosen).
- **Enunciado constraints applied:** a queue as its own Compose service (TD-01 recommendation follows from it), no `localhost` in configuration (TD-09), bytes never through the API for upload (TD-02), and at the end of the pipeline every TD must be `decided` with a filled `Decision` (the acceptance list asks for the open decisions "resolvidas e justificadas"; `/plan-resolve` fills the pending ones).
- **To validate in an early implementation spike (not verified here):** the lifecycle claim in (2) on the pinned image; Redis with AOF and `noeviction` as configured in Compose (TD-01 B) or, if pg-boss is chosen, that `pg-boss@11` runs cleanly under Jest/ts-jest and against the test-DB cleanup helper; that FFmpeg reading over HTTP range works against MinIO for a non-faststart MP4 (TD-05). **Claims not taken from the documentation consulted** (to be confirmed in `/plan-resolve` and `library-refs.md`, since CLAUDE.md requires following the official docs over prior knowledge): the 5 GiB single-PUT cap on real S3 (TD-02; MinIO's own docs state 5 TiB) and FFmpeg availability through `apt` on the Debian 12 base image (TD-04/TD-05).
- **PRD wording that depends on your choices:** PRD 05 requirement 3 ("A API não bufferiza") and the Range acceptance test assume TD-07 A; PRD 01 requirement 2 assumes a dedicated queue container (matches TD-01 B, conflicts with TD-01 A).
- **Binding rules vs. target architecture:** the enunciado makes the CLAUDE.md rules binding (Definition of Done, Compose service names instead of `localhost`, Git Flow, test suffixes, context7 lookups, reuse of project conventions) and treats the architecture in CLAUDE.md and the diagram as a target that this research refines and that must match the code at the end. No decision here relaxes a rule; the one operational rule adjusted is the startup rule in `nestjs-project/CLAUDE.md`, and only to include the worker (TD-04 Note).
- **Docs to update at closing (PRD 06):** root `CLAUDE.md` (architecture: queue is BullMQ on Redis, client uploads directly to storage, API streams; videos module and worker section) and `nestjs-project/CLAUDE.md` (services list, readiness checks for Redis and MinIO next to `pg_isready`, startup rule including the worker, videos endpoints); `docs/diagrams/software-arch.mermaid` (queue "TBD", `Frontend → Storage: Streams`, `API → Storage: Uploads`). The testing guide's storage note (local filesystem) is superseded by real MinIO for this phase.
