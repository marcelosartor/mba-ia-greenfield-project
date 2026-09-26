# CLAUDE.md

## Project Overview

StreamTube — a video sharing platform (YouTube-like). Users can upload, manage, and publish videos. Anonymous users can watch freely; social features (comments, subscriptions, likes) require authentication.

More info in the project overview: [docs/project-plan.md](docs/project-plan.md)

## Repository Structure

This is a monorepo with two main areas:

- `nestjs-project/` — Backend (NestJS 11, TypeScript, Express). One package with two processes: the API (`src/main.ts`) and the video worker (`src/worker.ts`). Contains modules for users, channels, videos, storage and queue; comments and the other social modules come in later phases.
- `docs/` — Project documentation, architecture diagrams, and planning.
- `next-frontend/` (Next.js) — not yet initialized

## Architecture (C4 Container Diagram)

See `docs/diagrams/software-arch.mermaid` for the full diagram. Key containers:

- **Frontend** (Next.js) → calls API via REST; watches videos through the API's streaming endpoint; sends video parts straight to Object Storage with presigned URLs
- **API** (Nest.js) → business rules, auth, reads/writes DB, starts and completes multipart uploads (the video bytes never pass through it on upload), serves streaming and download from storage, publishes jobs to the queue, sends emails
- **Video Worker** (FFmpeg, same Nest package, `src/worker.ts`) → consumes jobs from the queue, extracts metadata with ffprobe, generates the thumbnail with ffmpeg, updates DB and storage; also runs the scheduled clean-up of abandoned uploads
- **Database** (PostgreSQL) → users, channels, videos, comments, likes
- **Object Storage** (S3-compatible, MinIO in Docker) → video files (bucket `videos`) and thumbnails (bucket `thumbnails`)
- **Message Queue** (BullMQ on Redis 7) → video processing job queue, its dead-letter queue and the maintenance queue
- **Email Service** (SMTP) → account confirmation and password recovery

## Video Upload and Processing

Implemented in Phase 03 (`docs/phases/phase-03-videos/`); the decisions are in `docs/decisions/technical-decisions-phase-03-videos.md`.

- **Upload (resumable multipart, up to 10 GiB):** `POST /videos` creates a `draft` in the authenticated user's channel and opens an S3 multipart upload; the client asks for presigned part URLs (`POST /videos/{public_id}/upload/parts`), sends each part with `PUT` **directly to the storage**, and confirms with `POST /videos/{public_id}/upload/completion`, which validates the parts, completes the multipart and publishes the job. `GET /videos/{public_id}/upload` lists the parts already stored, so an interrupted upload can resume. The API never receives the video bytes on upload.
- **Processing:** the worker moves the video `draft` → `processing` → `ready` (or `error`), fills duration, size, codecs and metadata, and saves the thumbnail at `thumbnails/{video id}/default.jpg`. Transient failures are retried 3 times with exponential backoff, an invalid file goes straight to `error` (`INVALID_MEDIA`), and exhausted jobs go to the dead-letter queue (`PROCESSING_FAILED`). Every status change is a compare-and-set `UPDATE`.
- **Reading:** `GET /videos/{public_id}` (metadata), `/stream` (Range/206) and `/download` are public and serve only `ready` videos; stream and download pass through the API as streams, never loaded into memory.
- **Identifiers:** videos are addressed by `public_id` (11 URL-safe characters), never by the internal UUID. Storage keys use the UUID.
- **Presigned URLs use the Compose host** (`http://minio:9000`), so parts can only be sent from inside the Docker network in this phase; a browser client will need `STORAGE_PUBLIC_ENDPOINT` and CORS on the storage (frontend phase).
- **Queue and MinIO are real services** in `nestjs-project/compose.yaml`. The MinIO image is pinned to the last community release published on `quay.io` (never `latest`) and is for development and tests only.
- **Dependencies to know:** `@nestjs/bullmq` is pinned to `^11` (12 is ESM-only and this project is CommonJS) and BullMQ needs `ioredis` installed as its Redis client. FFmpeg comes from the `apt` package in `Dockerfile.dev`.

## Docker Networking

This project runs entirely in Docker containers. When configuring connections between services (database, cache, queue, etc.), **always use the Docker Compose service name** as the host — never `localhost` or `127.0.0.1`.

Inside a container, `localhost` refers to the container itself, not the host machine or other containers. Services communicate through the Docker Compose network using their service names (e.g., `db`, `redis`, `minio`, `mailpit`, `nestjs-api`).

- **Correct:** `DB_HOST=db` (the Compose service name)
- **Wrong:** `DB_HOST=localhost`

This applies to all environment variables, configuration files, and code that references service hosts.

## Working Principles

- **Single Responsibility:** each module, service, and function should have a clear, focused responsibility. Re-evaluate adherence at every step — when a module starts owning logic or entities that are not its own (e.g., a service creating an entity from another domain), extract it immediately into the proper module instead of deferring to a later corrective task.
- **Type Safety:** Strict TypeScript usage across all layers.
- **Testing:** Strong emphasis on pyramid testing at all levels to ensure reliability and maintainability.
- **Code Quality:** Use ESLint and Prettier for consistent code style. Code reviews should focus on readability, maintainability, and adherence to best practices.
- **Documentation:** Comprehensive docs for architecture, setup, and troubleshooting in `docs/`.

## Definition of Done (Technical)

A change is only considered complete when **all** of the following pass:

1. The relevant test suite passes (unit + integration + e2e affected by the change).
2. The full test suite passes before finishing the task.
3. TypeScript compiles cleanly: `npx tsc --noEmit` exits with code 0. Compilation errors must never be left as debt for future tasks.
4. Lint passes: `npm run lint`.

If any of these fails, the task is not done — fix the underlying issue before declaring completion.


## Git Conventions

- **Main branch:** `main` — never commit directly to it
- Branches: `feature/*`, `bugfix/*`, `hotfix/*`, `docs/*`
- **Commits:** short, descriptive messages focused on the "why" of the change
- **Workflow:** Git Flow conventions. Two long-lived branches:
  - `main` — stable, production-ready code 
  - `dev` — integration branch; all feature/bugfix/hotfix branches start from `dev` and merge back into `dev`
  - When `dev` is stable, it is merged into `main`

## Testing Policy

Every change must be tested. During development, run only the tests related to the modified code. Before finishing, always run the full test suite to ensure nothing is broken.

## Scope Limits

- Work on **one feature, fix, or refactoring at a time** — do not mix scopes
- Do not include cosmetic changes (formatting, renaming) alongside functional changes
- If something out of scope comes up during work, note it as a separate task instead of acting on it
- Focus on the defined scope for each task to ensure clarity and maintainability of the codebase.
- If you identify a necessary change that is out of scope, create a new issue or task for it instead of including it in the current work.

## Agent Skill Usage

When working on any task (planning, implementing, debugging, refactoring, 
reviewing, etc.), decompose the request into its underlying subtasks and 
concerns, then identify which available skills match any of them and activate 
those skills.

## Library Documentation Lookup

Before implementing any feature, you MUST use the **context7** MCP tool to look up the relevant library APIs and official documentation.

Always:

- Check the installed library version in the project manifest
- Retrieve the corresponding documentation using context7
- Cross-reference APIs to avoid deprecated or incompatible patterns
- Follow the official documentation over training data

Skip documentation lookup only for trivial operations such as:

- Variable declarations
- Basic control flow
- Simple CRUD using established project patterns

If a library is involved and there is uncertainty, documentation lookup is mandatory.
If the documentation returned does not match the installed version, flag the discrepancy before proceeding.