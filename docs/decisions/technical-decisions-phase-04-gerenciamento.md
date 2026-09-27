---
scope_type: phase
related_phases: [4]
status: decided
date: 2026-09-26
scope_description: "Backend for video and channel management: publication and visibility model, access to unpublished videos, categories, video edit contract, custom thumbnail, channel edit and public channel page, listing contract and query strategy, and rate limiting of the new routes."
---

# Technical Decisions — Phase 04: Gerenciamento de Vídeos e Canal

_Subprojects in scope:_

- `nestjs-project/` — hosts everything in this phase: the videos module (edit, publication, thumbnail, listings), the channels module (channel edit and public page), a new categories module, the migrations, the `@OptionalAuth()` extension of the global guard, and the throttler wiring.
- `next-frontend/` — the panel and the public channel page are frontend screens, but this phase is **backend only** by owner decision (PRD 00, "Fora de escopo"); they go to a later `phase-04-gerenciamento-frontend` cycle. The client-side contracts fixed here (edit, listing, thumbnail, optional auth) are consumed by that cycle. No open decision for this subproject in this document.

**Sources of requirements:** `docs/project-plan.md` (Phase 04 bullets, quoted literally in each `Capability:`) and the PRDs `docs/prd/prd-fase04-00` to `07` (cited as PRD 00–07). **PRD 00 holds 25 decisions already taken by the owner in a grilling session.** They are **not reopened here**: each TD whose theme is in PRD 00 records the owner's choice in `Decision:` (marked _owner, PRD 00 #n_), with the options considered kept for the record. Choices without a bullet in the plan are marked _(owner choice)_ and are traceable to PRD 00, not to the plan. TDs whose `Decision:` is `_[pending]_` are the implementation gaps the PRDs delegated to research.

**Inherited decisions (not reopened):** `technical-decisions-phase-03-videos.md` — TD-06 (`public_id` is the only public video identifier), TD-07 (stream and download through the API), TD-08 (status lifecycle with compare-and-set `UPDATE`; publication and visibility in columns **separate** from the processing status), TD-09 (two buckets); `technical-decisions-phase-02-auth.md` (custom global JWT guard + `@Public()`, `@nestjs/throttler`); `technical-decisions-openapi-docs-nestjs.md` (OpenAPI contract via `@nestjs/swagger`).

**Installed stack (checked):** NestJS 11.1 (`@nestjs/platform-express` 11.1.16 with `multer` 2.1.1), TypeORM 0.3.28, PostgreSQL 17, `@nestjs/throttler` 6.5.0, `@nestjs/swagger` 11.4.2, `class-validator` 0.14, BullMQ 6, FFmpeg 5.1.9 (apt, Debian 12) in the API and worker images, Node 25.6, CommonJS output. No image library (`sharp` and similar) is installed.

**Facts found in the code that constrain this phase** (each is used by a TD below):

1. `JwtAuthGuard` returns `true` for `@Public()` **without reading the token** (`src/auth/guards/jwt-auth.guard.ts`), so `request.user` never exists on public routes.
2. `ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }])` is one unnamed (`default`) throttler applied to every route by a global `ThrottlerGuard`, registered **after** `JwtAuthGuard`. The three public video reads escape it with a bare `@SkipThrottle()`, which in `@nestjs/throttler` 6 skips **only** the `default` throttler; any named throttler added later would still count them.
3. `ThrottlerModuleOptions` accepts `getTracker`, `generateKey` and `skipIf` per named throttler (checked in the 6.5.0 typings and in the guard source).
4. `Video` has no `description`, `category`, `visibility`, `published_at` or custom-thumbnail column; `Channel.description` exists (nullable text).
5. `ChannelsService` already handles nickname collisions by catching PostgreSQL `23505`; nicknames are generated from the e-mail prefix, so a **legacy nickname can be shorter than 3 characters or be a reserved word** (e.g. `admin@…` → `admin`, `me@…` → `me`).
6. Reproduced in the API container: a 790 KB PNG of 16000×16000 px (256 megapixels) is decoded by `ffmpeg -f png_pipe` and downscaled successfully in 1.7 s, i.e. a **decompression bomb passes a 2 MiB size limit**; `-max_alloc 200000000` makes the same input fail with exit 69. `png_pipe`, `jpeg_pipe` and `webp_pipe` demuxers exist in FFmpeg 5.1.9 and reject non-images with exit 1; a static WebP and an APNG (first frame) decode, but an **animated WebP fails** (`image data not found`).

---

## TD-01: Publication State and Visibility Model

**Scope:** Backend

**Capability:** Visibilidade do vídeo: público (aparece para todos) ou unlisted (somente via link); Fluxo de rascunho → publicação

**Context:** PRD 04. The plan needs an editorial state (draft or published) and a visibility (public or unlisted). Phase 03 TD-08 already decided that they live in columns **separate** from the processing `status` (`draft | processing | ready | error`), whose `draft` means "upload not processed yet" and is not the editorial draft. Phase 05 needs "unlisted only via direct link (no listings)" and Phase 07 needs a single notion of "listable" for grid, search and category filter. Existing `ready` videos need a defined state in the migration.

**Options:**

### Option A: `visibility` + nullable `published_at`, with `CHECK` that only `ready` has `published_at`
- `visibility` (`public | unlisted`) and `published_at` (null = editorial draft). Publish is a compare-and-set `UPDATE … WHERE status = 'ready'` (same pattern as TD-08 of Phase 03). Listable = `published_at IS NOT NULL AND visibility = 'public'`, defined once in the videos repository.
- **Pros:** one column carries both "is published" and "since when" (the panel's "tempo de publicação"); the worker's status transitions are untouched; the `CHECK` makes a non-`ready` video unpublishable at the database level.
- **Cons:** the null/non-null state is implicit (needs the single predicate); republishing resets `published_at`, so the first publication date is not kept.

### Option B: Boolean `is_published` + `published_at` + `visibility`
- Explicit flag plus timestamp plus visibility.
- **Pros:** the flag reads clearly in SQL.
- **Cons:** two columns that can disagree (needs one more `CHECK`); one more field for no new capability.

### Option C: Extend the processing `status` with `published`
- Add `published` (and visibility values) to the status enum.
- **Pros:** no new columns.
- **Cons:** contradicts Phase 03 TD-08; mixes two lifecycles and the worker's compare-and-set would have to know about editorial states.

**Recommendation:** **Option A** — smallest model that satisfies both bullets without touching the worker's lifecycle; the single listable predicate keeps Phases 05 and 07 consistent.

**Decision:** A (_owner, PRD 00 #1, #2, #3, #21, #23_). Details fixed by the owner: existing `ready` videos become `unlisted` with `published_at = now()` in the migration and the others stay draft; `POST /videos/{public_id}/publication` (optional `visibility` in the body, default `public`) and `DELETE` (unpublish, _owner choice_, no plan bullet) are idempotent; publishing a non-`ready` video → `409 VIDEO_NOT_PUBLISHABLE`; each publish writes `published_at = now()`, unpublish sets null, and changing `public` ↔ `unlisted` through `PATCH` **does not** change `published_at`; editing is allowed in any processing status and only writes columns the worker does not write.

---

## TD-02: Access to Unpublished Videos — Optional Authentication, Precedence and Cache

**Scope:** Cross-layer

**Capability:** Fluxo de rascunho → publicação; Visibilidade do vídeo: público (aparece para todos) ou unlisted (somente via link)

**Context:** PRD 04. Phase 03 TD-07 left this open: until Phase 04, any `ready` video is readable by anyone with the `public_id`, and the streaming service answers `Cache-Control: no-cache`. A draft must be readable by its owner only, while anonymous visitors keep watching published videos (fact 1: on `@Public()` routes the guard never reads the token, so the owner cannot be recognised). The frontend is a strict BFF: the browser only calls same-origin `/api/...` and Next injects `Authorization` from the session cookie, so the token can travel in the header only. Affects the guard (backend), the OpenAPI contract and the BFF (frontend cycle).

**Options:**

### Option A: `@OptionalAuth()` handled by the global `JwtAuthGuard`
- New metadata read by the existing guard: a valid token fills `request.user`; missing, malformed or expired token continues as anonymous. Services decide access from `request.user` and the video state. Token accepted in the `Authorization` header only.
- **Pros:** one guard, no new class; a stale token on a public video never blocks a viewer (same result as anonymous); the guard stays global.
- **Cons:** an expired token silently downgrades to anonymous, so the owner sees `404` on a draft instead of `401` (must be documented).

### Option B: Owner-only duplicate endpoints
- Keep `@Public()` for published reads and add authenticated twins (e.g. `/channels/me/videos/{id}/stream`) for drafts.
- **Pros:** no optional auth; authorization is trivially explicit.
- **Cons:** duplicates metadata, stream, download and thumbnail; the client must know which twin to call.

### Option C: Query-token or cookie for owner playback
- Accept `?token=` or a cookie so `<video src>` works for the owner.
- **Pros:** works without a BFF.
- **Cons:** tokens in URLs leak through logs and referrers; contradicts the BFF decision (Phase 02).

**Recommendation:** **Option A** — extends the guard the project already owns and keeps one URL per resource; the cost is a documented downgrade of invalid tokens.

**Decision:** A (_owner, PRD 00 #5, #6, #7, #24_). Precedence on reads (metadata, stream, download, thumbnail): (1) draft and requester is not the owner (anonymous included) → `404 VIDEO_NOT_FOUND`; (2) then a non-`ready` video → `409 VIDEO_NOT_READY`, reachable only by the owner. Responses carry `Cache-Control: private, no-cache`. Routes with `@OptionalAuth()` declare **optional** security in OpenAPI (no token or `access-token`) and `.claude/rules/nestjs-controllers.md` gets the exception to its ban on `@ApiBearerAuth` in `@Public()` routes. This is an anticipated extension of Phase 03 TD-07 (its open point said Phase 04 must add the block); the Phase 03 document, its Authorization Matrix and `Cache-Control` are updated at closing (PRD 07), recorded there as a Revision.

---

## TD-03: Video Categories Storage

**Scope:** Backend

**Capability:** Categorias de vídeo disponíveis na plataforma; Edição das informações do vídeo: título, descrição, categoria e thumbnail customizada

**Context:** PRD 01. The platform offers a fixed set of categories; the edit sets one; Phase 05 suggests videos of the same category and Phase 07 filters by category. The client needs a stable key. Existing videos have no category.

**Options:**

### Option A: `categories` table (UUID + unique `slug` + `name`), nullable `videos.category_id`, seeded by a data migration
- The API accepts and returns the `slug`; the list is served by `GET /categories`; the seed is a hand-written reversible migration.
- **Pros:** categories can be added without a deploy of code; FK integrity; the "same category" query joins on an id.
- **Cons:** one more table and module; the seed lives in a migration.

### Option B: PostgreSQL enum or `CHECK` list on `videos.category`
- **Pros:** no join; trivial.
- **Cons:** adding a category is a schema migration and a code change; the name shown to the user needs a second mapping.

### Option C: Free-text category
- **Pros:** no maintenance.
- **Cons:** breaks "categorias disponíveis na plataforma" and the Phase 07 filter.

**Recommendation:** **Option A** — the plan treats categories as platform data and the later phases query by category.

**Decision:** A (_owner, PRD 00 #8_). Table `categories` (UUID PK, unique `slug`), `category_id` nullable; the initial list is inserted by a reversible data migration (the exception `.claude/rules/typeorm-migrations.md` allows for data migrations; the schema part is generated by the CLI): `musica`, `jogos`, `educacao`, `entretenimento`, `esportes`, `noticias`, `tecnologia`, `filmes-e-animacao`, `viagens`, `culinaria`, `outros` (the list itself is an _owner choice_, not in the plan), ordered by name with `outros` last; Portuguese names, no internationalisation in this phase. An unknown slug on edit → `400 INVALID_CATEGORY`.

---

## TD-04: Video Edit Contract and Read Contract

**Scope:** Cross-layer

**Capability:** Edição das informações do vídeo: título, descrição, categoria e thumbnail customizada; Edição de vídeos a partir do painel

**Context:** PRD 02. The edit and the panel's "edit from the panel" are the same operation. Fact 4: `description`, category and visibility columns do not exist yet, and `title` is already `varchar(100)`. The frontend form and the OpenAPI client depend on the exact payload and on the read shape (Phase 05's page reads the same endpoint).

**Options:**

### Option A: Partial `PATCH /videos/{public_id}` with strict DTO
- Omitted field = unchanged; unknown field = `400`; `category` by `slug` (`null` clears); `visibility` also here. Read `GET /videos/{public_id}` gains `description`, `category`, `visibility`, `published_at`, `thumbnail_url`.
- **Pros:** one endpoint for the form and the panel; extra fields are compatible for readers.
- **Cons:** `null` vs omitted must be handled explicitly in the DTO.

### Option B: `PUT` with the full document
- **Pros:** no partial semantics.
- **Cons:** the panel would resend fields it does not know; clobbers concurrent changes.

### Option C: One endpoint per field
- **Pros:** each is trivial.
- **Cons:** many round trips for one form; more surface.

**Recommendation:** **Option A** — matches a form that changes some fields and keeps a single contract for the panel and the video page.

**Decision:** A (_owner, PRD 00 #4, #9, #10, #22_). Title 1–100 characters after `trim`; description optional up to 5,000; plain text only (control characters other than newline and tab rejected, line breaks normalised, never HTML) — the limits are _owner choices_. `thumbnail_url` is `/videos/{public_id}/thumbnail`. The owner (channel) is **not** added to the read response in this phase (Phase 05 requirement). Owner-only: another user `403`, anonymous `401`.

---

## TD-05: Empty `PATCH` Body and Concurrent Edits

**Scope:** Cross-layer

**Capability:** Edição das informações do vídeo: título, descrição, categoria e thumbnail customizada

**Context:** PRD 02 left two contract questions open: what `PATCH {}` does, and what happens when two tabs edit the same video. Both change what the client sees and what the tests assert. `updated_at` already exists on `Video` (`@UpdateDateColumn`).

**Options:**

### Option A: `{}` → `400`; last write wins; response returns the updated resource with `updated_at`
- **Pros:** an empty edit is almost certainly a client bug and is surfaced; no version handling; the client can show "saved at".
- **Cons:** a lost update between two tabs is possible (fields are independent, so only the same field conflicts).

### Option B: `{}` → `200` no-op; last write wins
- **Pros:** tolerant to generic form code.
- **Cons:** hides bugs; a form that submits nothing "succeeds".

### Option C: Optimistic concurrency with `If-Match` on `updated_at` or an ETag (`412`/`428` on mismatch)
- **Pros:** no lost updates.
- **Cons:** the client must round-trip the version; a `PATCH` racing with the worker's writes (status, metadata) would spuriously fail because `updated_at` moves without a user edit.

**Recommendation:** **Option A** — the owner is the only writer of these fields, the worker touches different columns (TD-01), and the extra cost of Option C would fire on worker writes.

**Decision:** A (_owner, /plan-resolve 2026-09-27_). `PATCH` with no editable field (`{}`) → `400`; last write wins, no version check; the response returns the updated resource with `updated_at`.

---

## TD-06: Custom Thumbnail — Upload Path, Storage and Serving

**Scope:** Cross-layer

**Capability:** Edição das informações do vídeo: título, descrição, categoria e thumbnail customizada

**Context:** PRD 03. The generated thumbnail is `thumbnails/{videoId}/default.jpg` (Phase 03, written by the worker). The owner may replace it; the worker must never overwrite the custom one; and a thumbnail is at most a few hundred KB. Phase 03 TD-02 chose direct-to-storage presigned upload for videos because of 10 GiB; that reasoning does not apply to a 2 MiB image. Phase 03 also left the presigned host reachable only inside the Docker network until the frontend phase (browser access to storage is not solved).

**Options:**

### Option A: Multipart to the API (multer memory storage, 2 MiB), API validates and writes to storage
- `PUT /videos/{public_id}/thumbnail` receives the file; the API validates and normalises it (TD-07) and writes `{videoId}/custom.jpg` in the `thumbnails` bucket; `custom_thumbnail_key` is set. `GET` serves the custom one if it exists, otherwise the generated one; `DELETE` removes the custom one (back to the generated).
- **Pros:** the API validates **before** storing (an unvalidated object never lands in the bucket); works from the BFF without exposing storage; a fixed key makes concurrent `PUT`s last-write-wins with no orphan object.
- **Cons:** image bytes cross the API (bounded by the 2 MiB limit); needs a multipart handler.

### Option B: Presigned single `PUT` to storage + confirmation call
- **Pros:** API out of the data path.
- **Cons:** unvalidated bytes land in the bucket before validation; the browser cannot reach the storage host in this phase; two round trips for a tiny file.

### Option C: Reuse the video multipart flow
- **Pros:** one mechanism.
- **Cons:** built for parts of a 10 GiB file; absurd overhead for one image.

**Recommendation:** **Option A** — bounded size makes the proxy cheap, and validation-before-storage is the security property that matters.

**Decision:** A (_owner, PRD 00 #11_). Two columns: `thumbnail_key` (worker) and `custom_thumbnail_key` (`{videoId}/custom.jpg`); the worker never touches the custom one; `GET` uses the access rules of the video (TD-02) and is `@OptionalAuth()`; `PUT` and `DELETE` are owner-only; limit 2 MiB (_owner choice_) → `413 IMAGE_TOO_LARGE`. Multer `limits.fileSize` is enforced while streaming (checked: `LIMIT_FILE_SIZE` in `@nestjs/platform-express` 11.1.16), so an oversized body is cut before it is buffered whole.

---

## TD-07: Custom Thumbnail — Content Validation and Normalisation

**Scope:** Backend

**Capability:** Edição das informações do vídeo: título, descrição, categoria e thumbnail customizada

**Context:** PRD 03. The upload is untrusted; the decision (PRD 00 #11) is to accept JPEG, PNG or WebP, decode to validate, and re-encode as a 640 px wide JPEG (this drops EXIF and any payload appended to the file). What is open is **how to decode**, the limits on dimensions and frames, and the failure time budget. The API image already ships FFmpeg (Phase 03 worker) and no image library. Facts checked in the container (fact 6): `-f png_pipe|jpeg_pipe|webp_pipe` on stdin rejects non-images; a 790 KB, 16000×16000 PNG is decoded in 1.7 s, so the byte limit alone does not bound memory; animated WebP fails to decode in FFmpeg 5.1.9.

**Options:**

### Option A: FFmpeg via `execFile` on a pipe, with the demuxer forced by the sniffed magic bytes
- The API sniffs the first bytes to pick JPEG, PNG or WebP (else `415 INVALID_IMAGE`), reads the width and height from the header and rejects above a pixel cap before decoding, then runs `ffmpeg -nostdin -f <jpeg_pipe|png_pipe|webp_pipe> -i pipe:0 -frames:v 1 -vf scale=640:-2 -c:v mjpeg -f image2 pipe:1` with `-max_alloc` and a timeout. No temporary file, no shell, no network protocol (input is stdin).
- **Pros:** no new dependency; the same tool and the same "restrict the demuxer" lesson as `SAFE_INPUT_OPTIONS`; first frame only, so animated PNG works and a bad file exits non-zero.
- **Cons:** spawns a process from the API; header parsing for the pixel cap is code we own; animated WebP is rejected (`INVALID_IMAGE`).

### Option B: `sharp` (libvips)
- `sharp(buffer, { limitInputPixels, animated: false }).resize(640).jpeg().toBuffer()`.
- **Pros:** in-process, built-in pixel limit and animated handling, faster.
- **Cons:** a native dependency to install and pin in the Docker image and CI; adds a second decoder next to the FFmpeg the project already ships.

### Option C: Store the upload as is after a magic-byte check
- **Pros:** trivial.
- **Cons:** keeps EXIF (GPS) and any trailing payload; no dimension normalisation; violates PRD 03's decoding requirement.

**Recommendation:** **Option A** — reuses FFmpeg (already a hard dependency) and its demuxer-restriction practice; the pixel cap (the recommendation is a cap around 16 megapixels, tunable) plus `-max_alloc` and a few-second timeout close the decompression-bomb case shown in fact 6. Choose B only if the team prefers a library over a process boundary.

**Decision:** A (_owner, /plan-resolve 2026-09-27_). FFmpeg via `execFile` on stdin/stdout: magic-byte sniffing picks `jpeg_pipe`, `png_pipe` or `webp_pipe` (anything else → `415 INVALID_IMAGE`); width and height read from the header and rejected above a pixel cap (~16 megapixels, configurable) before decoding; `-max_alloc` and a timeout of a few seconds; first frame only, re-encoded as a 640 px wide JPEG. Animated WebP is rejected (`INVALID_IMAGE`). No new dependency.

---

## TD-08: Channel Edit, Nickname Rules and Public Channel Page

**Scope:** Backend

**Capability:** Edição das informações do canal: nickname, nome e descrição; Página pública do canal com informações e listagem de vídeos

**Context:** PRD 06. The user has exactly one channel; `GET /channels/me` is not asked, but `PATCH /channels/me` edits it. The public page is addressed by nickname. Nicknames are unique (`UNIQUE`) and today generated from the e-mail prefix (fact 5).

**Options:**

### Option A: Editable nickname as the public address, format and reserved list validated on edit, `UNIQUE` decides conflicts
- `PATCH /channels/me` (name, nickname, description); `GET /channels/{nickname}` and `GET /channels/{nickname}/videos` are public. Format `^[a-z0-9_]{3,50}$`, reserved words rejected; the collision is decided by the database (`23505` mapped to `409`), the same pattern `ChannelsService` uses today.
- **Pros:** the address is the nickname the user chose; no second identifier; race-free.
- **Cons:** changing the nickname breaks old links (no redirect).

### Option B: Immutable nickname, separate editable handle/slug
- **Pros:** stable links.
- **Cons:** a second identifier the plan did not ask for; "editar nickname" would not edit the nickname.

### Option C: Public address by channel `public_id` (like videos)
- **Pros:** stable link.
- **Cons:** ugly addresses; the plan speaks of nickname as the channel identity.

**Recommendation:** **Option A** — it is what the bullet says and the database already guarantees uniqueness.

**Decision:** A (_owner, PRD 00 #12, #15, #16, #25_). Reserved words (_owner choice_): `me`, `admin`, `api`, `channels`, `videos`, `categories`, `auth`, `docs`, `support`. Public channel exposes `name`, `nickname`, `description`, `created_at` and `video_count` (only listable videos), never `id`, `user_id` or e-mail; list items expose `public_id`, `title`, `thumbnail_url`, `duration_seconds`, `published_at` (`video_count` and `duration_seconds` are _owner choices_, no plan bullet). Errors: `NICKNAME_ALREADY_EXISTS` (409), `NICKNAME_RESERVED` (400), `CHANNEL_NOT_FOUND` (404). **Module ownership:** `ChannelsService` resolves the channel and never queries `Video`; the two listing queries and their service live in the videos module and the controller only declares the routes under `/channels`.

**Discrepancy confirmed by the owner (fact 5), resolved as recommended:** PRD 00 #15 validates the format and reserved list **only on edit**. Nicknames generated at sign-up are not covered, so a legacy channel can be named `me` or `admin` (shadowing the static `/channels/me` routes) or have fewer than 3 characters. The public routes must therefore accept any stored nickname when reading, and it is recommended that sign-up generation also avoids reserved words (falling back to the existing random suffix). Owner accepted: sign-up generation avoids reserved words (falls back to the random suffix), and public reads accept any stored nickname.

---

## TD-09: Listing Contract — Pagination, Ordering and Panel Counters

**Scope:** Cross-layer

**Capability:** Painel de gerenciamento de vídeos do canal (thumbnail, título, visualizações, likes, comentários, tempo de publicação e status); Página pública do canal com informações e listagem de vídeos

**Context:** PRDs 05 and 06. Two listings: the owner's panel (all statuses) and the public channel page (listable only). Views, likes and comments do not exist until Phases 05 and 06, but the panel bullet names them. Phase 07 will add a search grid and a category filter and will reuse the pagination shape. The frontend renders a page selector or infinite scroll from this shape.

**Options:**

### Option A: Offset pagination `page` + `limit` with `total` and `total_pages`; fixed order
- Default `limit` 20, maximum 50; newest first (`created_at` in the panel, `published_at` on the public page) with the id as tie-break; no filters or `sort` in the panel.
- **Pros:** page selector works; stable order with the tie-break; same shape for both lists and later for Phase 07.
- **Cons:** `COUNT` per request; deep pages scan more rows.

### Option B: Cursor pagination (keyset)
- **Pros:** constant cost per page; no duplicates on insert.
- **Cons:** no total or jump-to-page; harder for a panel; more complex for the client.

### Option C: Offset without `total`
- **Pros:** cheaper.
- **Cons:** the panel cannot show "page X of Y".

**Recommendation:** **Option A** — a channel has a bounded number of videos, and a panel needs totals; Option B fits an infinite home feed better and can be added in Phase 07 without breaking this contract.

**Decision:** A (_owner, PRD 00 #13, #14_). Panel items carry `public_id`, title, thumbnail, `status`, `visibility`, `published_at`, `created_at`, and `views`, `likes`, `comments` fixed at `0`, documented as a placeholder until Phases 05 and 06 so the contract does not change when they arrive. `GET /channels/me/videos` is authenticated and only lists the caller's channel (no channel parameter); the panel has **no filters** (the `status`, `visibility` and `published_at` of each item are enough for now). Limits 20/50 are _owner choices_.

---

## TD-10: Listing Query Strategy — Indexes and `video_count`

**Scope:** Backend

**Capability:** Painel de gerenciamento de vídeos do canal (thumbnail, título, visualizações, likes, comentários, tempo de publicação e status); Página pública do canal com informações e listagem de vídeos

**Context:** PRDs 05 and 06 require efficient queries for channels with many videos and no N+1. `videos` today has `IDX_videos_channel_id` and `IDX_videos_status_created_at`. The public list orders by `published_at`, the panel by `created_at`, the public count uses the listable predicate (TD-01), and each item needs its thumbnail URL and, in the panel, category data.

**Options:**

### Option A: Partial composite indexes + `COUNT(*)` on the same predicate, single query with joins
- E.g. `(channel_id, created_at DESC, id DESC)` for the panel and a partial `(channel_id, published_at DESC, id DESC) WHERE published_at IS NOT NULL AND visibility = 'public'` for the public list and `video_count`; the category name comes with a join, the thumbnail URL is computed from `public_id`.
- **Pros:** no denormalised state; the `COUNT` uses the same partial index; correct by construction.
- **Cons:** `COUNT` cost grows with the channel (fine for expected sizes).

### Option B: Denormalised `video_count` on `channels`, updated on publish, unpublish and visibility change
- **Pros:** O(1) read.
- **Cons:** three code paths must keep it right; drift bugs; not needed at this size.

### Option C: Cache the count (Redis)
- **Pros:** cheap reads.
- **Cons:** invalidation and another dependency for the API; premature.

**Recommendation:** **Option A** — correct by construction; revisit B only with measured cost.

**Decision:** A (_owner, /plan-resolve 2026-09-27_). Composite index `(channel_id, created_at DESC, id DESC)` for the panel and partial index `(channel_id, published_at DESC, id DESC) WHERE published_at IS NOT NULL AND visibility = 'public'` for the public list and `video_count`; `video_count` is a `COUNT(*)` on the same listable predicate (no denormalised column, no cache); category by join, thumbnail URL computed from `public_id`; one query per page, no N+1.

---

## TD-11: Rate Limiting of the New Routes

**Scope:** Backend

**Capability:** Transversal — covers: Painel de gerenciamento de vídeos do canal (thumbnail, título, visualizações, likes, comentários, tempo de publicação e status); Edição de vídeos a partir do painel; Edição das informações do canal: nickname, nome e descrição; Página pública do canal com informações e listagem de vídeos

**Context:** PRDs 05, 06 and 07. Facts 2 and 3: the global limit is 10 requests per minute per IP on every route; a panel that reloads its list exhausts it, and a channel page requests up to 20 thumbnails at once. Named throttlers all apply globally, and a bare `@SkipThrottle()` only skips `default`; so adding throttlers without a skip design would also throttle the Phase 03 stream and download routes (and `@OptionalAuth()` routes would count a logged-in viewer's playback). `JwtAuthGuard` runs before `ThrottlerGuard`, so `request.user` exists when the limit is computed on authenticated routes.

**Options:**

### Option A: Named throttlers per traffic class, each with `skipIf` and its own tracker
- `default` (10/min per IP) only for the unauthenticated auth routes (sign-up, login, reset); `authenticated` (per user, keyed by the JWT `sub`) for authenticated routes; `public-read` (per IP) for the new public reads. Each throttler `skipIf` when the route is not in its class, and the existing video reads keep being skipped for all of them.
- **Pros:** limits sized to each class; per-user counting does not punish people behind one NAT; uses the per-throttler `getTracker`/`skipIf` of 6.5.0.
- **Cons:** the skip matrix must be tested (a 429 test per class).

### Option B: One throttler, per-route `@Throttle({ default: … })` overrides
- **Pros:** no new concept.
- **Cons:** every authenticated route repeats a number; IP tracking on authenticated routes; an omitted decorator silently falls back to 10/min.

### Option C: Raise the global limit
- **Pros:** trivial.
- **Cons:** weakens the limit on sign-up and login, which the 10/min was chosen for.

**Recommendation:** **Option A** — the only option that keeps the auth limit strict and gives the panel a per-user budget.

**Decision:** A (_owner, PRD 00 #17, #19, #20_). Values (all _owner choices_): `public-read` 300 per minute per IP, configurable by `THROTTLE_PUBLIC_READ_LIMIT`; `authenticated` 120 per minute per user for ordinary reads and writes (edit, publish, panel); upload routes of Phase 03 and the thumbnail `PUT`/`DELETE` in a stricter group of 20 per minute per user; sign-up, login and reset stay at 10 per minute per IP. Tests must show that the new public routes and the video reads are never answered `429`, and that the per-user limit does not affect another user.

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Publication State and Visibility Model | A (`visibility` + `published_at`) | A (owner, PRD 00) |
| TD-02 | Cross-layer | Access to Unpublished Videos — Optional Auth, Precedence, Cache | A (`@OptionalAuth()` in the global guard) | A (owner, PRD 00) |
| TD-03 | Backend | Video Categories Storage | A (`categories` table) | A (owner, PRD 00) |
| TD-04 | Cross-layer | Video Edit Contract and Read Contract | A (partial `PATCH`) | A (owner, PRD 00) |
| TD-05 | Cross-layer | Empty `PATCH` Body and Concurrent Edits | A (`{}` → 400, last write wins) | A (owner, /plan-resolve) |
| TD-06 | Cross-layer | Custom Thumbnail — Upload Path, Storage, Serving | A (multipart through the API) | A (owner, PRD 00) |
| TD-07 | Backend | Custom Thumbnail — Content Validation and Normalisation | A (FFmpeg on a pipe + pixel cap) | A (owner, /plan-resolve) |
| TD-08 | Backend | Channel Edit, Nickname Rules, Public Channel Page | A (nickname is the address) | A (owner, PRD 00) + sign-up avoids reserved nicknames (owner) |
| TD-09 | Cross-layer | Listing Contract — Pagination, Ordering, Panel Counters | A (offset `page`/`limit`) | A (owner, PRD 00) |
| TD-10 | Backend | Listing Query Strategy — Indexes and `video_count` | A (partial indexes + `COUNT`) | A (owner, /plan-resolve) |
| TD-11 | Backend | Rate Limiting of the New Routes | A (named throttlers with `skipIf`) | A (owner, PRD 00) |
