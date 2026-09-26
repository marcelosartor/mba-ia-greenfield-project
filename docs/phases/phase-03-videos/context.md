---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-09-19T21:07:21-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-09-20T11:31:47-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-09-19T21:07:21-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-09-19T21:07:21-03:00"
  docs/phases/phase-02-auth/context.md: "2026-09-19T21:07:21-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-09-19T21:07:21-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-09-20T11:34:00-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-09-19T21:07:21-03:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Upload e Processamento de Vídeos

**Capabilities** (literal, `docs/project-plan.md`):

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** _Not specified._
**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.
**Affected subprojects:** _None explicitly mentioned in the phase 03 block of project-plan.md._ (Fase 03 text names no subproject paths. CLAUDE.md notes next-frontend is not yet initialized.)
**Deferred subprojects:** _None._
**Sequencing notes:** Depende de: Fase 01, Fase 02.

**Neighbors (for boundary detection only):**

- **Phase 02:** Fluxo completo de criação de conta, confirmação por e-mail, login, logout e recuperação de senha.
- **Phase 04:** Edição das informações do vídeo, fluxo de rascunho e publicação, painel de administração do canal e página pública.

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | phase | Backend | Queue Technology | decided | B | bullmq@^6.3.8, @nestjs/bullmq@^11.0.5 |
|     └─ Last revision: 2026-09-20 — `@nestjs/bullmq` pinned to `^11.0.5`, not 12.x | | | | | | |
| phase-03-videos/TD-02 | phase | Cross-layer | Upload Protocol and Completion Detection | decided | B | @aws-sdk/client-s3@^3.1136.0, @aws-sdk/s3-request-presigner@^3.1136.0 |
| phase-03-videos/TD-03 | phase | Backend | Abandoned Upload and Orphan Draft Cleanup | decided | B | — |
| phase-03-videos/TD-04 | phase | Backend | Worker Placement and Packaging | decided | A | — |
| phase-03-videos/TD-05 | phase | Backend | Media Extraction and Thumbnail Generation | decided | A | — |
| phase-03-videos/TD-06 | phase | Backend | Public Video Identifier (Unique URL) | decided | B | — |
| phase-03-videos/TD-07 | phase | Cross-layer | Streaming and Download Delivery | decided | A | — |
| phase-03-videos/TD-08 | phase | Backend | Video Status Lifecycle, Failure Handling and Idempotency | decided | A | — |
|     └─ Last revision: 2026-09-20 — `videos` gains an `upload_completed_at` column and status `draft` covers both c… | | | | | | |
| phase-03-videos/TD-09 | phase | Backend | Bucket and Key Layout and Storage Access | decided | A | @aws-sdk/client-s3@^3.1136.0, @aws-sdk/s3-request-presigner@^3.1136.0 |
| phase-03-videos/TD-10 | phase | Repo-wide | MinIO Distribution (Image Source and Pinning) | decided | A | — |

_Source files:_

- phase-03-videos — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase, related_phases: [3])

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-09, phase-03-videos/TD-10 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01, phase-03-videos/TD-04, phase-03-videos/TD-08 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02, phase-03-videos/TD-03 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-02, phase-03-videos/TD-03, phase-03-videos/TD-08 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-04, phase-03-videos/TD-05, phase-03-videos/TD-08 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-05 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-06 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-07 |
| Download do vídeo pelo usuário | phase-03-videos/TD-07 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** it delivers the queue as a real Compose service, which the enunciado and PRD 01 require and whose absence is an automatic-fail item, and it has the strongest Nest integration (the official queues recipe, CJS-compatible, no ESM friction with Jest). The costs are operating Redis (AOF persistence and `noeviction` per the BullMQ docs) and the lack of atomic enqueue: publish right after the DB commit with `jobId = videoId`, and let the TD-03 sweeper re-enqueue videos whose upload completed but never left `draft` (the fixed `jobId` makes re-publishing idempotent). A dedicated DLQ is a small manual addition (TD-08). **Trade-off acknowledged:** pg-boss 11.x is technically the tighter fit for a Postgres-centred system (atomic enqueue, native DLQ, no new service), and is the better choice if a queue living inside the `db` service is acceptable to whoever grades the Compose deliverable; this document does not assume it is.
**Libraries:** bullmq@^6.3.8, @nestjs/bullmq@^11.0.5

**Revisions:**
- 2026-09-20 — `@nestjs/bullmq` pinned to `^11.0.5`, not 12.x. Rationale: @nestjs/bullmq 12.0.0 is ESM-only (`"type": "module"`) while the project is CommonJS + Jest/ts-jest; 11.0.5 is CommonJS and accepts bullmq 6 and NestJS 11 (registry check, 2026-09-20).

### phase-03-videos/TD-02

**Recommendation:** it is the only option that meets both the "not through the API" rule and the plan's resume requirement while staying portable to real S3. Completion detection is an explicit client `complete` call: `CompleteMultipartUpload` must be invoked by someone anyway and the API is the natural caller, so storage-event webhooks (endpoint, auth, event-loss handling) would add moving parts for no gain. Parameters: server-fixed part size 64 MiB (10 GiB → 160 parts, far below the 10,000 cap), presigned part URLs valid for 1 h, size limit 10 GiB validated at init and re-checked from `ListParts` before completing, file extension/MIME allowlist at init (mp4, mov, mkv, webm — the authoritative validity check is ffprobe in TD-05), initial draft title derived from the file name, channel taken from the authenticated user, never from the request body. Per the project's REST conventions (plural resource nouns, correct methods and status codes) the handshake is modelled as resources, not verbs: creating the draft and its upload session is `POST` on the videos collection, part URLs and the completion request are sub-resources of that video's upload; the exact paths are fixed in the plan.
**Libraries:** @aws-sdk/client-s3@^3.1136.0, @aws-sdk/s3-request-presigner@^3.1136.0

### phase-03-videos/TD-03

**Recommendation:** Option A does not work on the target storage per its documentation and would leave rows behind anyway; keep it as a belt-and-braces addition if the deployment later moves to real S3. Threshold: 24 h without completion.
**Libraries:** —

### phase-03-videos/TD-04

**Recommendation:** the worker's whole job is to mutate the same `videos` rows the API creates, so sharing entity, config and DoD pipeline outweighs the isolation benefits of B at this scale; C is a layout refactor outside this phase's scope. Install FFmpeg in the shared `Dockerfile.dev` so the real-FFmpeg integration tests (PRD 03) run inside `nestjs-api`, and start the worker process on `docker compose up`.
**Libraries:** —

### phase-03-videos/TD-05

**Recommendation:** **Option A**, falling back to B only if remote probing fails for a file (recorded as a retryable error, TD-08). Thumbnail frame at `min(10% of duration, 10 s)`, JPEG scaled to 640 px wide preserving aspect ratio, stored at a deterministic key so retries overwrite. Persisted metadata: `duration_seconds`, `width`, `height`, `video_codec`, `audio_codec`, `bit_rate`, `format_name`, `size_bytes` as columns, plus a `metadata` JSONB with the trimmed ffprobe output. An input that ffprobe cannot parse is a non-retryable failure (TD-08).
**Libraries:** —

### phase-03-videos/TD-06

**Recommendation:** short, unguessable, race-safe through the unique constraint the PRD already requires, and independent of the internal PK. Generate with `crypto` rather than `nanoid` (v5 is ESM-only in this CommonJS project). Storage keys use the internal UUID (TD-09), so the public identifier can stay purely a URL concern.
**Libraries:** —

### phase-03-videos/TD-07

**Recommendation:** **Option A** for Phase 03 — it satisfies the acceptance criteria as written, keeps authorization per request (Phase 04's visibility rules take effect immediately), and keeps the streaming logic behind one service so a later switch to B does not change the public endpoint. Endpoints are `@Public()` for `ready` videos only; any other status returns a domain error (unknown → not found, not ready → conflict). **Open point:** until Phase 04 adds publication gating, any `ready` video is reachable by anyone holding its unguessable public id (TD-06), i.e. it behaves like "unlisted"; confirm this is acceptable for the phase.
**Libraries:** —

### phase-03-videos/TD-08

**Recommendation:** the CAS transitions are also the answer to invalid transitions (rejected, surfaced as a domain error on the API side) and to idempotency under at-least-once delivery. Status values: `draft` (created, upload not yet completed), `processing`, `ready`, `error`, with a check constraint. **Dependency to note:** Phase 04 introduces a "rascunho → publicação" flow; keep publication/visibility as separate columns rather than overloading this processing status. **Convention interaction:** the service rule for background tasks ("log the error, do not rethrow") targets fire-and-forget handlers and cron jobs; a BullMQ processor must throw for `attempts`/`backoff` to apply, so retryable errors are thrown from the processor, while non-retryable ones are raised as BullMQ's `UnrecoverableError`, which the BullMQ docs describe as moving the job straight to the failed set and bypassing the remaining attempts.
**Libraries:** —

**Revisions:**
- 2026-09-20 — `videos` gains an `upload_completed_at` column and status `draft` covers both cases: null means the upload is still in progress, set means the upload completed and the video awaits the worker. The TD-03 sweeper aborts drafts whose `upload_completed_at` is null after 24 h and re-enqueues those where it is set; the completion request is idempotent (a repeated call sees the marker); abandoned drafts are removed, so the status enum stays `draft`, `processing`, `ready`, `error`. Rationale: Tornar a conclusão idempotente sob retry do cliente.

### phase-03-videos/TD-09

**Recommendation:** thumbnails will need different access and caching than originals (home grid in Phase 07), so separating them now avoids a later data move. Keys use the internal UUID, never the public id (TD-06). Buckets are created by a `minio-init` Compose service (MinIO client, idempotent "make bucket if missing"), with API and worker waiting on its successful completion. Use `forcePathStyle` and the Compose service host (`http://minio:9000`) for all traffic, including presigning: in Phase 03 there is no browser client, and tests plus the manual 10GB proof run inside the Docker network, so the "always the Compose service name, never `localhost`" rule holds with no exception. **Deferred, to be recorded rather than solved now:** a presigned URL is valid only for the host it was signed for (the signature covers `Host`), so when the frontend uploads from a browser a separate, browser-reachable signing endpoint (an optional `STORAGE_PUBLIC_ENDPOINT`, unset by default) and MinIO CORS for the PUT origin will be needed; that belongs to the frontend phase. Application code reaches storage through a `StorageService` abstraction (the pattern the project's testing guide recommends), and its tests run against the real MinIO service in Compose: the enunciado and PRD 01 require real infrastructure, which supersedes the guide's local-filesystem note for storage. New environment keys (storage endpoint, credentials, bucket names, Redis host) are required or default to Compose service names, never `localhost`; the existing `DB_HOST` and `APP_URL` defaults in `env.validation.ts` are not a pattern to copy.
**Libraries:** @aws-sdk/client-s3@^3.1136.0, @aws-sdk/s3-request-presigner@^3.1136.0

### phase-03-videos/TD-10

**Recommendation:** **Option A** for development and tests, plus two guardrails: application code stays strictly S3-API with endpoints/credentials from env (so C becomes a config swap), and the known limitation is recorded in the docs and CLAUDE.md. Revisit if the pinned image disappears or the project moves toward deployment.
**Libraries:** —

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (@nestjs/config) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.

**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.

**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with registerAs) — The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`. Initial files for Phase 01: `src/config/database.config.ts`, `src/config/app.config.ts`.

**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Option A (Shared registerAs factory) — Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.

**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### phase-02-auth/TD-01

**Recommendation:** Argon2id — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.

**Libraries:** `argon2@^0.41.x`

### phase-02-auth/TD-02

**Recommendation:** Option A (@nestjs/passport) — The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier.

**Note:** Decision deliberately diverged from the Recommendation during implementation — custom guards were preferred over `@nestjs/passport` to keep the dependency surface smaller; social login is not on the near-term roadmap, so the plugin-architecture benefit did not justify the extra abstraction layer.

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-03

**Recommendation:** Option A (Refresh Token Rotation) — Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed. Race conditions can be mitigated with a short grace period for the old token.

**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Option B (Random Opaque Tokens in DB) — Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs (e.g., API keys). Keeps email tokens decoupled from the JWT auth system.

**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** Option A (@nestjs-modules/mailer) — Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with MailHog/Mailpit for local development without external dependencies, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.

**Libraries:** `@nestjs-modules/mailer@^2.x`, `handlebars@^4.x`

### phase-02-auth/TD-06

**Recommendation:** Option A (class-validator + class-transformer) — This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.

**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Option A (Custom Domain Exception Filter) — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity. The custom filter cost is low — two small files.

**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** Option A (@nestjs/throttler) — Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient. Using express-rate-limit would bypass NestJS's DI and guard lifecycle for no clear benefit.

**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-09

**Recommendation:** Option B (Opaque) — Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate.

**Note:** Decision deliberately diverged from the Recommendation — JWT was kept to reuse the access-token signing/verification infrastructure (`@nestjs/jwt`), trading token size and base64-readability for a single token format across the codebase.

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-10

**Recommendation:** Option A — The platform is a video sharing service with URL-based channel handles. A strict `[a-z0-9_]` allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes. Hyphens can always be added in a future iteration if user feedback justifies it.

**Libraries:** —

### phase-02-auth-frontend/TD-01

**Recommendation:** Three reasons. (1) **Architectural fit.** The strict-BFF model in `next-frontend-config-base/TD-03` already nominates the Route Handler as the only NestJS caller; cookie-based sessions are the natural match, and Auth.js's framework adds layers between the BFF and the cookie that buy nothing because the backend is the auth authority — Auth.js's value (DB adapters, OAuth providers, magic-link, `getServerSession` helpers) is mostly unused in this configuration. (2) **Smaller blast radius.** A ~50-LOC session helper is grep-friendly, debuggable, and test-friendly via the existing MSW+BFF integration test pattern; a misconfigured Auth.js callback is a longer fault-isolation loop. (3) **Compatibility with Next.js 16 / React 19.** Built-in `next/headers` `cookies()` is the canonical primitive both runtimes already use; Auth.js v5 versions track Next.js majors with a lag, adding compatibility risk that Option A does not have. Option C is rejected as unsafe (`localStorage` for refresh tokens) and architecturally regressive (loses RSC personalization).
**Libraries:** —

### phase-02-auth-frontend/TD-02

**Recommendation:** Three reasons. (1) **Defense in depth on the cookie content** — `httpOnly` blocks JS, encryption blocks accidental log/proxy inspection; the marginal cost is one ~3KB dep. (2) **Single cookie to manage** simplifies logout (one `session.destroy()` call) and avoids the orphan-cookie failure mode of Option A. (3) **Room to carry minimal user metadata** (`userId`, `email`, `channelSlug`) lets `app/layout.tsx` RSC render the authenticated chrome (avatar, channel name) without a per-render `/auth/me` round-trip — Phase 04+ gains compound here. Option A is a viable downgrade if the team rejects `iron-session` for any reason; the migration A→B (or B→A) is a one-Route-Handler refactor with no test changes downstream because the BFF interface is unchanged. Option C is rejected: it solves a problem (server-side revocation) the project does not have at the cost of infrastructure the project does not own.
**Libraries:** iron-session

### phase-02-auth-frontend/TD-03

**Recommendation:** The single-flight detail is non-trivial and goes in the helper from day one — tested by MSW with a "two concurrent intercepted upstream calls; one refresh expected" assertion. Option B's client-driven pattern is rejected because it doesn't replace Option A (RSC still needs server-side refresh) — adopting B means doing both. Option C's pre-emptive timer is rejected because the failure modes (multiple tabs, sleep/wake) outweigh the latency saving and force a `"use client"` shell near the root.
**Libraries:** —

### phase-02-auth-frontend/TD-04

**Recommendation:** Three reasons. (1) **Decoupled from TD-05** — works with Route Handlers OR Server Actions; the form code does not change if TD-05 is revisited later. (2) **Aligned with shadcn's canonical form primitive** — the project already commits to `radix-nova` shadcn (`components.json`); `npx shadcn@latest add form` produces react-hook-form wrappers; choosing react-hook-form means using the supported primitive instead of hand-rolling around it. (3) **Zod-first developer ergonomics match the rest of the FE foundation** — `next-frontend-config-base/TD-01` chose Zod 4 for env; the same schemas-as-source-of-truth pattern carries to forms with zero new validator paradigm. Option B is rejected for impedance with shadcn's primitive and for over-investing in progressive-enhancement that the strict-BFF model does not require. Option C is rejected for the per-field boilerplate and the loss of client-side feedback on a project that values quick, type-safe form iteration.
**Libraries:** react-hook-form, @hookform/resolvers

### phase-02-auth-frontend/TD-05

**Recommendation:** Three reasons. (1) **Strict-BFF alignment.** `next-frontend-config-base/TD-03` named Route Handlers as the BFF surface; Option A keeps every mutation visible under `app/api/**`. (2) **Test scaffold already exists** — `next-frontend/CLAUDE.md` § Testing and `next-frontend-msw-foundation` were authored for Route-Handlers-as-functions; Option A reuses them with zero invention. (3) **Single mutation surface** — Phase 02 sets the precedent for Phases 03–07; uniformity beats per-mutation idiom-picking when the cost of inconsistency compounds (Option C). Option B has real ergonomic appeal for the simplest forms but fragments the BFF surface and forces test-pattern reinvention; if the team later wants progressive enhancement for specific forms, the migration A→B is per-form and doesn't require touching unrelated routes — A is the safer default and the cheaper baseline.
**Libraries:** —

### phase-02-auth-frontend/TD-06

**Recommendation:** Two reinforcing reasons. (1) **No first-render flicker, no round-trip** — the session is delivered in the same response as the page HTML; the Client Provider hydrates with the correct initial state; users never see "Login" briefly turn into their avatar. (2) **No new BFF endpoint** — the cookie is the source of truth, RSC reads it, the Provider broadcasts it; the BFF surface stays minimal. The `router.refresh()` requirement after mid-session mutations is a small price (one line in the relevant mutation handler) for the structural benefits. Option B is rejected for the double-read-and-flicker; Option C is dominated by Option B and rejected.
**Libraries:** —

### phase-02-auth-frontend/TD-07

**Recommendation:** Three reasons. (1) **First-paint-correct** — the user sees the right outcome on the first paint, no skeleton, no flicker. (2) **Single integration pattern across both flows** — confirmation is RSC-only; reset is RSC + Client form (TD-04, TD-05 patterns reused) — both share the "RSC owns the token, Client Component owns the input" split. (3) **Email-prefetch behavior** is solved at the backend's idempotent-confirmation level (a small note for `/plan-build` to confirm; not a separate TD). Option B's Route-Handler-as-link-target adds redirects for no clean gain. Option C is dominated.
**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** é a única opção que preserva as decisões anteriores (`class-validator` em TD-06 de phase-02-auth) sem re-platform; o CLI plugin com `classValidatorShim: true` aproveita os decoradores `class-validator` existentes para inferir schemas, mantendo o boilerplate baixo. Nestia tem mérito técnico real mas o custo de migração do stack de validação inviabiliza-a sem uma decisão upstream de supersede de TD-06. Manual authoring é descartado.
**Libraries:** @nestjs/swagger

### openapi-docs-nestjs/TD-02

**Recommendation:** o custo marginal sobre Option A é apenas um npm script (~15 linhas) e o benefício é uma fundação correta para futura integração FE (codegen offline) sem perder a UI interativa que dev/QA usam. Option B sozinho pune a experiência de desenvolvimento em dev/local; Option A sozinho compromete o pipeline de codegen futuro. Combinar é dominante.
**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** alinha com a postura defensiva já estabelecida em phase 02 e não compromete consumidores legítimos (o `openapi.json` commitado em TD-02 cumpre o papel de "spec consultável fora da UI"). Re-abrir como Option A ou C é trivial no futuro se um caso de uso de API pública aparecer.
**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOpti... _(from phase 01)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function... _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 01)_
- Database connection parameters (host, port, etc.) are sourced from a single `databaseConfig` factory — never duplicated between `AppModule` and `da... _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning option... _(from phase 01)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| "Confirmação de conta via e-mail com link de ativação" | deferred | phase-02-auth-frontend | deferred_to_next_phase — UI landing screen de-scoped 2026-05-14; FE confirmation flow (TD-07) picked up by a future phase. BE side unchanged in `phase-02-auth`. |
| "Logout" | deferred | phase-02-auth-frontend | deferred_to_next_phase — logout button lives inside authenticated chrome (typically Phase 04). Phase 02 still implements POST `/api/auth/logout` (BFF route handler + `session.destroy()`) so the contract is ready when the chrome lands. |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | phase-02-auth-frontend | deferred_to_next_phase — `/forgot-password` ships this phase sending the e-mail; the reset-password destination screen is absent from Figma → link destination remains a 404 until a later phase delivers the screen via `/screen-inventory` extension run. Documented as a known gap. |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | phase-02-auth-frontend | a tela de confirmação da conta não será implementada nesta fase corrente, será adiada — the umbrella bullet's full coverage requires the confirmação and reset-password destination screens; both are deferred per Non-UI rows above. The 3 ship-this-phase telas (signup, login, forgot-password) are inventoried and covered by their own verbs; the umbrella bullet itself is deferred to the phase that lands the missing screens. |

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### nestjs-project

| Artifact type | Required layers |
|---------------|-----------------|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` |
| Service with branching + DB | Unit: branch logic (mock repo) + Integration: DB contract |
| Service with DB only (no branching) | Integration: DB contract |
| Service with configured lib (JWT, cache) | Unit: real lib with test config |
| Service with side-effect dep (email, storage) | Integration: real capture service (Mailpit) or local adapter |
| Module with configured imports | Unit: compilation test |
| Controller | E2E only — do NOT write unit tests |
| DTO | E2E: one validation wiring test per endpoint |
| Guard (delegates to service for business logic) | E2E + Unit if complex internal logic |
| Guard (simple, delegates to Passport) | E2E only |
| Strategy (Passport) | E2E via guard |
| Pipe (custom transformation/validation) | Unit |
| Interceptor (response transform, logging) | Unit and/or E2E |
| Exception Filter | Unit + E2E |
| Middleware | E2E |
