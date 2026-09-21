---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-09-20T11:34:45-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-09-20T11:34:00-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-09-20T11:31:47-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-09-19T21:07:21-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Entregar o upload de vídeos de até 10GB direto ao object storage (multipart pré-assinado, sem passar o arquivo pela API) com pré-cadastro automático do vídeo como rascunho, o processamento automático em segundo plano por um worker consumindo uma fila (duração, metadados e thumbnail extraídos com ffprobe/ffmpeg), o identificador de URL única por vídeo e a entrega por streaming (Range/206) e download — com storage, fila e worker subindo junto com a stack do backend no Docker Compose.

---

## Step Implementations

### SI-03.1 — Configurar dependências, namespaces de config e variáveis de ambiente de storage e fila

**Description:** Instala as bibliotecas decididas para storage e fila e cria os namespaces de configuração (`storage`, `redis`, `video`) validados por Joi, com chaves novas obrigatórias ou com padrão igual ao nome do serviço do Compose, nunca `localhost`.

**Technical actions:**

1. Instalar dentro do container `bullmq@^6.3.8`, `@nestjs/bullmq@^11.0.5`, `@aws-sdk/client-s3@^3.1136.0` e `@aws-sdk/s3-request-presigner@^3.1136.0` em `nestjs-project/package.json` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`, `phase-03-videos/TD-09`); `@nestjs/bullmq` fica em 11.x porque a 12.x é ESM-only (Revision de `phase-03-videos/TD-01`)
2. Criar `src/config/storage.config.ts` com `registerAs('storage', …)` expondo `endpoint`, `region`, `accessKeyId`, `secretAccessKey`, `videosBucket`, `thumbnailsBucket` e `publicEndpoint` (opcional, sem valor por padrão) (per `phase-03-videos/TD-09`, `phase-01-configuracao-base/TD-03`)
3. Criar `src/config/redis.config.ts` (`host`, `port`) e `src/config/video.config.ts` (`partSizeBytes`, `workerConcurrency`, `processingTimeoutMs`) com `registerAs` (per `phase-01-configuracao-base/TD-03`)
4. Estender `envValidationSchema` em `src/config/env.validation.ts` com `STORAGE_ENDPOINT` (padrão `http://minio:9000`), `STORAGE_REGION` (padrão `us-east-1`, escolha deste plano porque o SDK exige uma região), `STORAGE_ACCESS_KEY_ID` e `STORAGE_SECRET_ACCESS_KEY` (obrigatórias), `STORAGE_BUCKET_VIDEOS` (padrão `videos`), `STORAGE_BUCKET_THUMBNAILS` (padrão `thumbnails`), `STORAGE_PUBLIC_ENDPOINT` (opcional), `REDIS_HOST` (padrão `redis`), `REDIS_PORT` (padrão 6379), `VIDEO_UPLOAD_PART_SIZE_BYTES` (padrão 67108864, mínimo 5242880), `VIDEO_WORKER_CONCURRENCY` (padrão 1) e `VIDEO_PROCESSING_TIMEOUT_MS` (per `phase-03-videos/TD-09`, `phase-01-configuracao-base/TD-02`)
5. Registrar as três configs em `ConfigModule.forRoot({ load })` no `AppModule` e documentar todas as chaves novas em `.env.example`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `envValidationSchema` | Integration: chaves obrigatórias, padrões por nome de serviço, `STORAGE_PUBLIC_ENDPOINT` opcional | `src/config/env.validation.integration-spec.ts` |
| `storageConfig` | Unit: leitura do ambiente e `publicEndpoint` indefinido por padrão | `src/config/storage.config.spec.ts` |
| `redisConfig`, `videoConfig` | Unit: leitura do ambiente e valores padrão | `src/config/redis.config.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Iniciar a API sem `STORAGE_ACCESS_KEY_ID` falha na validação de ambiente com mensagem que cita a chave ausente
- Sem `STORAGE_ENDPOINT` e sem `REDIS_HOST` definidos, os valores efetivos de configuração são `http://minio:9000` e `redis`
- Sem `STORAGE_PUBLIC_ENDPOINT` definido, `storage.publicEndpoint` é indefinido
- `VIDEO_UPLOAD_PART_SIZE_BYTES` abaixo de 5242880 é rejeitado na validação de ambiente
- `.env.example` lista todas as chaves novas e nenhum valor novo contém `localhost` ou `127.0.0.1`
- `npm ls @nestjs/bullmq` dentro do container reporta a versão 11.x

---

### SI-03.2 — Infra: subir MinIO, buckets e Redis no Compose e instalar FFmpeg na imagem dev

**Description:** Adiciona ao `compose.yaml` o object storage, a criação dos buckets e a fila (Redis) e instala o FFmpeg na imagem de desenvolvimento compartilhada, para que a stack do backend suba com storage e fila reais.

**Technical actions:**

1. Adicionar em `compose.yaml` o serviço `minio` com a imagem `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` (nunca `latest`), comando `server /data --console-address ":9001"`, credenciais lidas do `.env`, volume nomeado e healthcheck (per `phase-03-videos/TD-10`, `phase-03-videos/TD-09`)
2. Adicionar o serviço `minio-init` com a imagem `quay.io/minio/mc` fixada em tag ou digest resolvido na implementação e registrado no `progress.md`, que cria os buckets `videos` e `thumbnails` de forma idempotente (criar só se faltar) e termina; depende do `minio` saudável (per `phase-03-videos/TD-09`, `phase-03-videos/TD-10`)
3. Adicionar o serviço `redis` (imagem `redis:7`, versão escolhida por este plano) iniciado com `--appendonly yes --maxmemory-policy noeviction` e healthcheck (per `phase-03-videos/TD-01`)
4. Instalar `ffmpeg` (que traz o `ffprobe`) na `Dockerfile.dev`, compartilhada por `nestjs-api` e worker, para que os testes com FFmpeg real rodem dentro do `nestjs-api` (per `phase-03-videos/TD-04`)
5. Fazer `nestjs-api` depender de `redis` e `minio` na condição `service_healthy` e de `minio-init` na condição `service_completed_successfully`, para só iniciar depois de as dependências estarem prontas (PRD 01, requisito 7), e repassar as variáveis de ambiente novas

**Tests:** _(empty — Infra)_

**Dependencies:** SI-03.1 — as chaves de ambiente novas alimentam os serviços

**Acceptance criteria:**

- `docker compose up -d` seguido de `docker compose ps` mostra `minio`, `redis` e `nestjs-api` saudáveis ou em execução e `minio-init` encerrado com código 0
- `docker compose exec nestjs-api ffprobe -version` retorna a versão do ffprobe
- Os buckets `videos` e `thumbnails` existem logo após o `up`, listáveis por um cliente S3 apontando para `http://minio:9000`, sem passo manual
- `docker compose exec redis redis-cli config get maxmemory-policy` retorna `noeviction`
- Nenhuma configuração dos serviços novos (`compose.yaml` e `.env.example`) usa `localhost` ou `127.0.0.1`

---

### SI-03.3 — Implementar StorageModule com StorageService

**Description:** Cria a abstração `StorageService` sobre o cliente S3, usada pela API e pelo worker para multipart, URLs pré-assinadas, leitura por intervalo e gravação de objetos, sempre pelo host do serviço do Compose.

**Technical actions:**

1. Criar `src/storage/storage.service.ts` e `src/storage/storage.module.ts`: `S3Client` com `endpoint` e `forcePathStyle: true` vindos de `storageConfig`, módulo exportando o `StorageService` (per `phase-03-videos/TD-09`; `@aws-sdk/client-s3` em `library-refs.md`)
2. Implementar os métodos de multipart: `createMultipartUpload`, `presignUploadPart` (`getSignedUrl` de `UploadPartCommand` com `expiresIn` 3600), `listParts` (paginado), `completeMultipartUpload` e `abortMultipartUpload` (per `phase-03-videos/TD-02`; `@aws-sdk/s3-request-presigner` em `library-refs.md`)
3. Implementar os métodos de objeto: `presignGetObject` (URL lida pelo worker), `putObject` (thumbnail), `headObject` e `getObjectRange` (repassa o cabeçalho `Range` ao `GetObjectCommand` e devolve o `Body` em stream com `ContentRange`, `ContentLength`, `ETag` e `ContentType`) (per `phase-03-videos/TD-05`, `phase-03-videos/TD-07`)
4. Adicionar `StorageUnavailableException` (`STORAGE_UNAVAILABLE`, 502) a `src/common/exceptions/domain.exception.ts` e converter nela as falhas de comunicação com o storage (per Error Catalog)
5. Exportar `StorageModule` para ser importado por `VideosModule` e pelo módulo do worker

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration: multipart de duas partes por URLs pré-assinadas, `listParts`, completar, leitura por `Range`, `putObject` e URL pré-assinada de GET contra o MinIO real do Compose | `src/storage/storage.service.integration-spec.ts` |
| `StorageService` | Unit: falha de comunicação vira `StorageUnavailableException` | `src/storage/storage.service.spec.ts` |
| `StorageModule` | Unit: compilação da injeção de dependência | `src/storage/storage.module.spec.ts` |

**Dependencies:** SI-03.1 — configuração; SI-03.2 — MinIO no Compose

**Acceptance criteria:**

- Um multipart de duas partes enviadas por `PUT` nas URLs pré-assinadas e completado deixa no bucket `videos` um objeto com o tamanho somado das partes
- `getObjectRange` com `bytes=0-1023` devolve exatamente 1024 bytes e `ContentRange` igual a `bytes 0-1023/{total}`
- Depois de `abortMultipartUpload`, `listParts` do mesmo `UploadId` falha e o objeto não existe no bucket
- Com o endpoint do storage inacessível, qualquer operação lança exceção com `errorCode` `STORAGE_UNAVAILABLE` e `httpStatus` 502
- A URL de `presignGetObject` permite ler o objeto por HTTP sem credenciais e usa o host `minio`, não `localhost`

---

### SI-03.4 — Implementar QueueModule com as filas BullMQ

**Description:** Cria o módulo de filas sobre o `redis` do Compose, com as três filas do plano e o publicador que enfileira o processamento de um vídeo de forma idempotente.

**Technical actions:**

1. Criar `src/queue/queue.constants.ts` com os nomes das filas `video-processing`, `video-processing-dlq` e `video-maintenance` e o nome do job `process-video` (nomes definidos por este plano)
2. Criar `src/queue/queue.module.ts` com `BullModule.forRootAsync` lendo `redisConfig` (host pelo nome do serviço `redis`) e `BullModule.registerQueue` das três filas; a `video-processing` recebe `defaultJobOptions` com `attempts: 3`, `backoff: { type: 'exponential', delay: 5000 }` e retenção de jobs falhos via `removeOnFail` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-08`; `@nestjs/bullmq` e `bullmq` em `library-refs.md`)
3. Criar `src/queue/video-processing.publisher.ts` com `publish(videoId)`, que adiciona o job `process-video` com payload `{ videoId }` e `jobId` igual ao `videoId` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-08`)
4. Exportar o `VideoProcessingPublisher` e as filas para `VideosModule` e para o módulo do worker

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingPublisher` | Integration: publicação real no Redis do Compose, idempotência por `jobId`, opções de tentativa e backoff | `src/queue/video-processing.publisher.integration-spec.ts` |
| `QueueModule` | Unit: compilação da injeção de dependência | `src/queue/queue.module.spec.ts` |

**Dependencies:** SI-03.1 — configuração do Redis; SI-03.2 — serviço `redis` no Compose

**Acceptance criteria:**

- Publicar o mesmo `videoId` duas vezes deixa exatamente um job em `video-processing`, com payload `{ "videoId": "<uuid>" }`
- O job publicado carrega `attempts` igual a 3 e backoff exponencial com atraso base de 5000 ms
- As filas `video-processing-dlq` e `video-maintenance` aceitam a adição de jobs
- O host de conexão usado pelo módulo é o nome do serviço `redis`, lido da configuração

---

### SI-03.5 — Criar migration, entidade Video e repositório

**Description:** Cria a tabela `videos` ligada ao canal, a entidade e o repositório com criação de rascunho resistente a colisão do identificador público e transições de status por compare-and-set.

**Technical actions:**

1. Criar a migration `src/database/migrations/<timestamp>-CreateVideos.ts` com `up` e `down` reversíveis, criando `videos` conforme `### Data Model → Video`, a FK para `channels`, o CHECK de `status`, o unique `UQ_videos_public_id` e os índices (per `phase-03-videos/TD-06`, `phase-03-videos/TD-08`, `phase-03-videos/TD-03`)
2. Criar `src/videos/video-status.enum.ts` (`draft`, `processing`, `ready`, `error`) e `src/videos/entities/video.entity.ts` com `@ManyToOne` para `Channel`, seguindo `.claude/rules/nestjs-entities.md` (per `phase-03-videos/TD-08`)
3. Criar `src/videos/public-id.util.ts` que gera 11 caracteres de alfabeto URL-safe com `crypto.randomBytes`, sem dependência nova (per `phase-03-videos/TD-06`)
4. Criar `src/videos/videos.repository.ts` com `createDraft` (repete a inserção em violação `23505` de `UQ_videos_public_id`), `findByPublicId` e `transitionStatus` (`UPDATE … WHERE id = $1 AND status IN (<esperados>)`, devolvendo se alguma linha foi atualizada) (per `phase-03-videos/TD-06`, `phase-03-videos/TD-08`); registrar `VideosModule` com `TypeOrmModule.forFeature([Video])` e importá-lo no `AppModule`
5. Atualizar `cleanAllTables` em `src/test/create-test-data-source.ts` para apagar `videos` antes de `channels`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| migration `CreateVideos` | Integration: `up` e `down` reversíveis | `src/database/migrations.integration-spec.ts` |
| `Video` | Integration: unicidade de `public_id`, FK para canal, CHECK de `status`, padrões | `src/videos/entities/video.entity.integration-spec.ts` |
| `VideosRepository` | Integration: criação concorrente sem colisão, compare-and-set e transição inválida | `src/videos/videos.repository.integration-spec.ts` |
| `generatePublicId` | Unit: comprimento e alfabeto | `src/videos/public-id.util.spec.ts` |
| `VideosModule` | Unit: compilação da injeção de dependência | `src/videos/videos.module.spec.ts` |

**Dependencies:** none — a tabela `channels` já existe das Fases 01 e 02

**Acceptance criteria:**

- A migration cria `videos` ligada a `channels` e `migration:revert` a remove sem deixar índice ou constraint
- Inserir dois vídeos com o mesmo `public_id` viola a restrição de unicidade
- Inserir um vídeo com `status` fora de `draft`, `processing`, `ready` e `error` é rejeitado pelo banco
- Cinquenta criações concorrentes de rascunho produzem cinquenta `public_id` distintos
- A transição de `processing` para `ready` executada quando o vídeo já está `ready` não altera nenhuma linha
- O `public_id` gerado tem 11 caracteres, todos do alfabeto URL-safe

---

### SI-03.6 — Endpoint POST /videos

**Route:** POST /videos
**Test Specs:** see `nestjs-project/specs/videos-create.plan.md`
**Authorization:** Authenticated — o canal é sempre o do usuário do JWT, nunca do corpo (per `### Authorization Matrix`)

**Description:** Inicia um upload: cria o vídeo como rascunho no canal do usuário autenticado e abre o multipart no storage, devolvendo o tamanho e o número de partes.

**Technical actions:**

1. Criar `src/videos/dto/create-video.dto.ts` (`filename`, `content_type`, `size_bytes`, com class-validator) e `src/videos/video-upload.constants.ts` (allowlist extensão ↔ MIME de `mp4`, `mov`, `mkv` e `webm`, limite de 10737418240 bytes e expiração de 3600 s) conforme `### API Contracts → POST /videos` (per `phase-03-videos/TD-02`)
2. Adicionar `ChannelNotFoundException`, `VideoTooLargeException` e `UnsupportedVideoFormatException` a `src/common/exceptions/domain.exception.ts` e o método `findByUserId` em `ChannelsService`, exportado por `ChannelsModule`, para que o módulo de vídeos não consulte a entidade de outro domínio (per Error Catalog)
3. Criar `src/videos/video-uploads.service.ts` com `initiate(userId, dto)`: resolve o canal pelo `sub` do JWT, valida formato e tamanho, cria o rascunho com `video_key` `{channelId}/{videoId}/source.{ext}` e título derivado do nome do arquivo, chama `createMultipartUpload`, grava `upload_id` e, se o storage falhar, remove o rascunho (per `phase-03-videos/TD-02`, `phase-03-videos/TD-06`, `phase-03-videos/TD-09`)
4. Criar `src/videos/videos.controller.ts` com `POST /videos` (201), `@ApiTags`, `@ApiBearerAuth('access-token')`, `@ApiResponse` com `ApiErrorEnvelope` e `@CurrentUser()`, delegando ao service (per `.claude/rules/nestjs-controllers.md`)
5. Registrar controller e services em `VideosModule`, importando `StorageModule` e `ChannelsModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoUploadsService.initiate` | Unit: formato inválido, tamanho acima de 10 GiB, canal ausente e falha do storage removendo o rascunho (repositório e storage mockados) | `src/videos/video-uploads.service.spec.ts` |
| `VideoUploadsService.initiate` | Integration: rascunho no Postgres e multipart no MinIO reais | `src/videos/video-uploads.service.integration-spec.ts` |

**Dependencies:** SI-03.3 — abre o multipart; SI-03.5 — cria o rascunho

**Acceptance criteria:**

- `POST /videos` autenticado com `{ "filename": "a.mp4", "content_type": "video/mp4", "size_bytes": 200000000 }` retorna `201` com `public_id` de 11 caracteres, `status: "draft"`, `part_size_bytes: 67108864` e `part_count: 3`
- A linha criada em `videos` tem `status = 'draft'`, `channel_id` igual ao canal do usuário autenticado e `upload_completed_at` nulo
- `POST /videos` sem `Authorization` retorna `401`
- `POST /videos` com `size_bytes` igual a 10737418241 retorna `413` com `error: "VIDEO_TOO_LARGE"`
- `POST /videos` com `filename` `a.exe` retorna `415` com `error: "UNSUPPORTED_VIDEO_FORMAT"`
- `POST /videos` com o campo extra `channel_id` no corpo retorna `400`, sem criar vídeo
- Com o storage indisponível, `POST /videos` retorna `502` com `error: "STORAGE_UNAVAILABLE"` e não deixa rascunho órfão

---

### SI-03.7 — Endpoint GET /videos/{public_id}/upload

**Route:** GET /videos/{public_id}/upload
**Test Specs:** see `nestjs-project/specs/videos-upload-session.plan.md`
**Authorization:** Owner — dono do canal do vídeo (per `### Authorization Matrix`)

**Description:** Permite ao dono retomar um upload interrompido, listando as partes que já estão no storage, e fixa a verificação de dono reutilizada pelos demais endpoints de sessão de upload.

**Technical actions:**

1. Adicionar `VideoNotFoundException` e `VideoAccessDeniedException` a `src/common/exceptions/domain.exception.ts` (per Error Catalog)
2. Criar em `VideoUploadsService` o método `assertOwner(userId, video)`, que compara `channels.user_id` com o `sub` do JWT, e `getUploadSession(userId, publicId)`, que devolve `uploaded_parts` a partir de `listParts` enquanto `upload_completed_at` é nulo e uma lista vazia quando o upload já foi concluído (per `phase-03-videos/TD-02`)
3. Criar o DTO de resposta `src/videos/dto/upload-session-response.dto.ts` (`public_id`, `status`, `upload_completed`, `part_size_bytes`, `uploaded_parts`)
4. Adicionar `GET :publicId/upload` em `VideosController` com `@ApiBearerAuth('access-token')` e `@ApiResponse` dos erros 401, 403, 404 e 502, delegando ao service

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoUploadsService.getUploadSession` | Unit: dono, não dono, vídeo inexistente e upload já concluído (repositório e storage mockados) | `src/videos/video-uploads.service.spec.ts` |
| `VideoUploadsService.getUploadSession` | Integration: partes realmente enviadas ao MinIO aparecem em `uploaded_parts` | `src/videos/video-uploads.service.integration-spec.ts` |

**Dependencies:** SI-03.6 — vídeo e multipart precisam existir

**Acceptance criteria:**

- `GET /videos/{public_id}/upload` do dono, depois de enviar as partes 1 e 2, retorna `200` com `uploaded_parts` contendo `{ "part_number": 1, "size_bytes": <tamanho da parte> }` e a parte 2
- `GET /videos/{public_id}/upload` por outro usuário autenticado retorna `403` com `error: "VIDEO_ACCESS_DENIED"`
- `GET /videos/{public_id}/upload` com `public_id` inexistente retorna `404` com `error: "VIDEO_NOT_FOUND"`
- `GET /videos/{public_id}/upload` sem `Authorization` retorna `401`
- Para um vídeo com upload já concluído, retorna `200` com `upload_completed: true` e `uploaded_parts` vazio

---

### SI-03.8 — Endpoint POST /videos/{public_id}/upload/parts

**Route:** POST /videos/{public_id}/upload/parts
**Test Specs:** see `nestjs-project/specs/videos-upload-parts.plan.md`
**Authorization:** Owner — dono do canal do vídeo (per `### Authorization Matrix`)

**Description:** Emite URLs pré-assinadas de `UploadPart` para as partes pedidas, de modo que o cliente envie os bytes direto ao storage, sem passar pela API.

**Technical actions:**

1. Criar `src/videos/dto/request-upload-parts.dto.ts` (`part_numbers`: 1 a 100 inteiros distintos entre 1 e 10000) conforme `### API Contracts → POST /videos/{public_id}/upload/parts`
2. Adicionar `UploadAlreadyCompletedException` a `src/common/exceptions/domain.exception.ts` (per Error Catalog)
3. Criar em `VideoUploadsService` o método `requestPartUrls(userId, publicId, dto)`: verifica o dono, exige `upload_completed_at` nulo e chama `presignUploadPart` para cada número com validade de 3600 s (per `phase-03-videos/TD-02`)
4. Adicionar `POST :publicId/upload/parts` (201) em `VideosController` com `@ApiBearerAuth('access-token')` e `@ApiResponse` dos erros 400, 401, 403, 404, 409 e 502

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoUploadsService.requestPartUrls` | Unit: dono, não dono, upload já concluído e validade das URLs (repositório e storage mockados) | `src/videos/video-uploads.service.spec.ts` |
| `VideoUploadsService.requestPartUrls` | Integration: uma URL retornada aceita `PUT` de uma parte real no MinIO | `src/videos/video-uploads.service.integration-spec.ts` |

**Dependencies:** SI-03.7 — verificação de dono e sessão de upload

**Acceptance criteria:**

- `POST /videos/{public_id}/upload/parts` do dono com `{ "part_numbers": [1, 2] }` retorna `201` com duas URLs em `parts` e `expires_in: 3600`
- Um `PUT` com os bytes da parte em uma URL retornada é aceito pelo storage
- `POST /videos/{public_id}/upload/parts` depois de o upload ser concluído retorna `409` com `error: "UPLOAD_ALREADY_COMPLETED"`
- `POST /videos/{public_id}/upload/parts` com `part_numbers` vazio ou com 101 itens retorna `400`
- `POST /videos/{public_id}/upload/parts` por usuário que não é o dono retorna `403` com `error: "VIDEO_ACCESS_DENIED"`
- `POST /videos/{public_id}/upload/parts` sem `Authorization` retorna `401`

---

### SI-03.9 — Endpoint POST /videos/{public_id}/upload/completion

**Route:** POST /videos/{public_id}/upload/completion
**Test Specs:** see `nestjs-project/specs/videos-upload-completion.plan.md`
**Authorization:** Owner — dono do canal do vídeo (per `### Authorization Matrix`)

**Description:** Confirma o término do upload: valida as partes, completa o multipart, registra `upload_completed_at` e publica o job de processamento, de forma idempotente diante de repetição do cliente.

**Technical actions:**

1. Adicionar `UploadIncompleteException` a `src/common/exceptions/domain.exception.ts` (per Error Catalog)
2. Criar em `VideoUploadsService` o método `completeUpload(userId, publicId)`: verifica o dono; se `upload_completed_at` já estiver preenchido, devolve a mesma resposta 202 sem completar o multipart de novo nem publicar outro job; senão lista todas as partes (paginado), exige a sequência 1..N com partes intermediárias iguais a `part_size_bytes` e soma até 10 GiB — acima disso aborta o multipart, remove o rascunho e responde `VIDEO_TOO_LARGE` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-08`)
3. Completar o multipart e registrar `upload_completed_at` preenchido e `upload_id` nulo em um único UPDATE; só depois do commit chamar `VideoProcessingPublisher.publish(videoId)`, e, se a publicação falhar, registrar o erro em log e ainda assim responder 202, deixando o sweeper republicar (per `phase-03-videos/TD-01`, `phase-03-videos/TD-03`, Revision de `phase-03-videos/TD-08`)
4. Adicionar `POST :publicId/upload/completion` (202) em `VideosController` com `@ApiBearerAuth('access-token')` e `@ApiResponse` dos erros 401, 403, 404, 409, 413 e 502
5. Importar `QueueModule` em `VideosModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoUploadsService.completeUpload` | Unit: partes ausentes, soma acima de 10 GiB, repetição idempotente, dono e falha de publicação (repositório, storage e publisher mockados) | `src/videos/video-uploads.service.spec.ts` |
| `VideoUploadsService.completeUpload` | Integration: multipart real de várias partes no MinIO, job real no Redis e `upload_completed_at` no Postgres | `src/videos/video-uploads.service.integration-spec.ts` |

**Dependencies:** SI-03.8 — sessão de upload e URLs de partes; SI-03.4 — publicação do job

**Acceptance criteria:**

- `POST /videos/{public_id}/upload/completion` do dono depois de enviar todas as partes retorna `202` com `upload_completed: true`; a linha fica com `upload_completed_at` preenchido e `upload_id` nulo, e o objeto existe no bucket `videos` com o tamanho somado das partes
- Depois da confirmação, existe um job em `video-processing` cujo `jobId` é o id do vídeo e cujo payload é `{ "videoId": "<uuid>" }`
- Repetir a confirmação retorna `202` de novo sem criar um segundo job
- Confirmar com uma parte intermediária ausente retorna `409` com `error: "UPLOAD_INCOMPLETE"` e mantém `upload_completed_at` nulo
- Quando a soma das partes excede 10 GiB, retorna `413` com `error: "VIDEO_TOO_LARGE"` e o rascunho deixa de existir
- Com o Redis indisponível, retorna `202` e o vídeo permanece `draft` com `upload_completed_at` preenchido
- Confirmar por usuário que não é o dono retorna `403` e, sem `Authorization`, retorna `401`

---

### SI-03.10 — Implementar MediaProbeService e ThumbnailService com ffprobe e ffmpeg

**Description:** Cria os serviços de mídia do worker: extração de duração e metadados com ffprobe e geração do thumbnail com ffmpeg, ambos lendo a origem por URL pré-assinada, sem baixar o arquivo.

**Technical actions:**

1. Criar `src/worker/media/media-probe.service.ts` que executa `ffprobe -print_format json -show_format -show_streams <url>` com `execFile`, timeout de `videoConfig.processingTimeoutMs` e `AbortSignal`, lendo a origem por URL pré-assinada (per `phase-03-videos/TD-05`)
2. Mapear a saída do ffprobe para `duration_seconds`, `width`, `height`, `video_codec`, `audio_codec`, `bit_rate`, `format_name` e `size_bytes`, mais o `metadata` JSONB reduzido; arquivo que o ffprobe não interpreta, ou sem trilha de vídeo, lança `InvalidMediaError` (não retentável) (per `phase-03-videos/TD-05`, `phase-03-videos/TD-08`)
3. Criar `src/worker/media/thumbnail.service.ts` que executa `ffmpeg -ss <t> -i <url> -frames:v 1` com `t = min(10% da duração, 10 s)`, JPEG de 640 px de largura com proporção preservada, gravado em arquivo temporário do worker, lido e removido (per `phase-03-videos/TD-05`)
4. Criar `src/worker/media/media.errors.ts` com `InvalidMediaError` e marcar como transitórias as falhas de timeout e de leitura remota, para o processor decidir entre `UnrecoverableError` e nova tentativa (per `phase-03-videos/TD-08`)
5. Registrar os serviços em `MediaModule`, exportado ao módulo do worker

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `MediaProbeService` | Integration: ffprobe real sobre MP4 gerado no teste com `ffmpeg -f lavfi`, sem `faststart`, enviado ao MinIO e lido por URL pré-assinada, e sobre arquivo corrompido | `src/worker/media/media-probe.service.integration-spec.ts` |
| `ThumbnailService` | Integration: ffmpeg real gera JPEG de 640 px de largura a partir do vídeo no MinIO | `src/worker/media/thumbnail.service.integration-spec.ts` |
| mapeamento do ffprobe | Unit: parsing do JSON, ausência de áudio e ausência de vídeo | `src/worker/media/media-probe.mapper.spec.ts` |
| `MediaModule` | Unit: compilação da injeção de dependência | `src/worker/media/media.module.spec.ts` |

**Dependencies:** SI-03.2 — FFmpeg na imagem; SI-03.3 — URL pré-assinada de leitura

**Acceptance criteria:**

- Um MP4 válido gerado no teste e lido por URL pré-assinada do MinIO produz `duration_seconds` próximo da duração real, além de `width`, `height` e `video_codec`
- Um MP4 com o índice no fim do arquivo (sem `faststart`) é lido por URL pré-assinada sem baixar o arquivo inteiro para o disco do worker
- Um arquivo corrompido ou sem trilha de vídeo faz o serviço lançar `InvalidMediaError`
- O thumbnail gerado é um JPEG válido com 640 px de largura e proporção preservada, do frame em `min(10% da duração, 10 s)`
- Um vídeo sem trilha de áudio resulta em `audio_codec` nulo

---

### SI-03.11 — Criar o worker e o VideoProcessor (caminho feliz)

**Description:** Cria o processo separado do worker, dentro do mesmo pacote, que consome `video-processing`, move o vídeo de `draft` a `processing`, extrai metadados, gera e grava o thumbnail e conclui em `ready`, e sobe como serviço do Compose.

**Technical actions:**

1. Criar `src/worker.ts` (entrypoint com `NestFactory.createApplicationContext(WorkerModule)` e shutdown hooks) e `src/worker/worker.module.ts` importando configuração, banco, `StorageModule`, `QueueModule` e `MediaModule`, sem HTTP (per `phase-03-videos/TD-04`)
2. Criar `src/worker/video.processor.ts` com `@Processor('video-processing')` estendendo `WorkerHost`: transição compare-and-set `draft` → `processing` (exigindo `upload_completed_at`), URL pré-assinada da origem, probe e thumbnail, `putObject` em `thumbnails/{videoId}/default.jpg`, gravação dos metadados e de `thumbnail_key` e transição `processing` → `ready` (per `phase-03-videos/TD-04`, `phase-03-videos/TD-05`, `phase-03-videos/TD-08`)
3. Configurar a concorrência do worker com `videoConfig.workerConcurrency` e adicionar em `package.json` os scripts `start:worker` e `start:worker:dev` que executam `dist/worker` (`nest start --entryFile worker`, com `--watch` no segundo) (per `phase-03-videos/TD-04`)
4. Adicionar em `compose.yaml` o serviço `video-worker`, com a mesma imagem e volumes do `nestjs-api`, que executa o processo do worker no `up` em vez de ficar ocioso, com `depends_on` em `db` e `redis` na condição `service_healthy` e em `minio-init` na condição `service_completed_successfully`, para só iniciar depois de as dependências estarem prontas (per `phase-03-videos/TD-04`; PRD 01, requisito 7)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessor` | Integration: Postgres, Redis, MinIO e FFmpeg reais — MP4 gerado no teste enviado ao bucket, job publicado, vídeo chega a `ready` com metadados e thumbnail no storage | `src/worker/video.processor.integration-spec.ts` |
| `WorkerModule` | Unit: compilação da injeção de dependência sem controllers HTTP | `src/worker/worker.module.spec.ts` |

**Dependencies:** SI-03.4 — fila; SI-03.5 — entidade e transições; SI-03.10 — serviços de mídia

**Acceptance criteria:**

- Depois de publicar o job de um vídeo com upload concluído, o vídeo passa por `processing` e termina em `ready` com `duration_seconds`, `width`, `height`, `video_codec` e `format_name` preenchidos
- O objeto `{videoId}/default.jpg` existe no bucket `thumbnails` e `thumbnail_key` guarda essa chave
- Cada transição de status é refletida no banco: `processing` enquanto o job roda e `ready` ao final
- `docker compose up -d` deixa o serviço `video-worker` em execução consumindo a fila, com `ffprobe` disponível no contêiner
- O `video-worker` inicia sem subir servidor HTTP e sem depender do processo do `nestjs-api`

---

### SI-03.12 — Tratar falhas, retentativas, DLQ e idempotência no worker

**Description:** Classifica os erros do processamento, aplica as 3 tentativas com backoff apenas às falhas transitórias, encaminha jobs esgotados à DLQ e garante que um job repetido sobre vídeo já concluído não reprocessa nada.

**Technical actions:**

1. Em `VideoProcessor`, tratar `InvalidMediaError`: transição compare-and-set `processing` → `error` com `error_code = 'INVALID_MEDIA'` e `error_message` curto, seguida de `UnrecoverableError` para pular as tentativas restantes (per `phase-03-videos/TD-08`; `bullmq` em `library-refs.md`)
2. Relançar as falhas transitórias (storage, rede, banco) para acionar `attempts: 3` com backoff exponencial, sem capturá-las com a regra de "logar e não relançar" de tarefas em segundo plano (per `phase-03-videos/TD-08`)
3. Adicionar o manipulador `@OnWorkerEvent('failed')`: quando as tentativas se esgotam, publicar em `video-processing-dlq` o payload `{ videoId, failedReason, attemptsMade }` e aplicar a transição compare-and-set para `error` com `error_code = 'PROCESSING_FAILED'` (per `phase-03-videos/TD-08`)
4. Tornar o processamento idempotente: job de vídeo já `ready` ou inexistente termina como no-op, e transição inválida (0 linhas atualizadas) não lança erro (per `phase-03-videos/TD-08`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessor` | Integration: arquivo corrompido, falha transitória injetada nas duas primeiras tentativas, falha persistente com DLQ e job repetido sobre vídeo `ready`, com Postgres, Redis, MinIO e FFmpeg reais | `src/worker/video.processor.failures.integration-spec.ts` |
| `VideoProcessor` | Unit: classificação de erros e transições compare-and-set (dependências mockadas) | `src/worker/video.processor.spec.ts` |

**Dependencies:** SI-03.11 — worker e processor

**Acceptance criteria:**

- Um arquivo corrompido leva o vídeo a `error` com `error_code = 'INVALID_MEDIA'` depois de uma única tentativa
- Uma falha transitória nas duas primeiras tentativas seguida de sucesso na terceira termina com o vídeo em `ready`
- Uma falha persistente esgota as 3 tentativas: o vídeo termina em `error` com `error_code = 'PROCESSING_FAILED'` e existe um job em `video-processing-dlq` com o `videoId`
- Um job para um vídeo já `ready` termina sem reprocessar e sem alterar `thumbnail_key`
- A nova entrega de um job de vídeo em `processing` conclui em `ready` e mantém um único objeto de thumbnail, pois a chave é determinística

---

### SI-03.13 — Implementar o sweeper de uploads abandonados e a republicação de jobs

**Description:** Cria a tarefa agendada do worker que limpa uploads abandonados e republica o processamento de vídeos cujo upload terminou mas cujo job nunca foi publicado, cobrindo a ausência de enfileiramento atômico com o banco.

**Technical actions:**

1. Adicionar em `src/videos/videos.repository.ts` as consultas `findAbandonedDrafts(before)` (vídeos `draft` com `upload_completed_at` nulo e `created_at` anterior ao limite) e `findCompletedAwaitingWorker(before)` (vídeos `draft` com `upload_completed_at` preenchido e anterior ao limite), apoiadas no índice (`status`, `created_at`) (per `phase-03-videos/TD-03`)
2. Criar `src/worker/uploads-sweeper.service.ts`: para cada rascunho abandonado há mais de 24 h, chamar `abortMultipartUpload` e remover a linha; para cada vídeo com upload concluído há mais de 5 minutos (carência definida por este plano) e ainda em `draft`, chamar `VideoProcessingPublisher.publish(videoId)`, idempotente pelo mesmo `jobId` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-03`, Revision de `phase-03-videos/TD-08`)
3. Criar `src/worker/uploads-sweeper.processor.ts` com `@Processor('video-maintenance')` que executa o sweeper (per `phase-03-videos/TD-03`)
4. Registrar na inicialização do worker o agendador `upsertJobScheduler('abandoned-uploads-sweep', { every: 900000 })` (15 minutos, intervalo definido por este plano) na fila `video-maintenance` (per `phase-03-videos/TD-03`; `bullmq` em `library-refs.md`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `UploadsSweeperService` | Integration: Postgres, MinIO e Redis reais com `created_at` e `upload_completed_at` recuados no banco — abandonado é abortado e removido, concluído sem job é republicado, recente não é tocado | `src/worker/uploads-sweeper.service.integration-spec.ts` |
| agendador `abandoned-uploads-sweep` | Integration: o agendador existe em `video-maintenance` depois da inicialização do worker | `src/worker/uploads-sweeper.scheduler.integration-spec.ts` |

**Dependencies:** SI-03.9 — marcador `upload_completed_at` e publicação; SI-03.11 — worker

**Acceptance criteria:**

- Um rascunho com `upload_completed_at` nulo criado há mais de 24 h é removido e o multipart dele deixa de existir no storage depois de uma execução do sweeper
- Um rascunho com `upload_completed_at` nulo criado há 1 h permanece intacto depois de uma execução do sweeper
- Um vídeo `draft` com upload concluído há mais de 5 minutos e sem job ganha um job em `video-processing` cujo `jobId` é o id do vídeo; executar o sweeper duas vezes não duplica o job
- Depois da inicialização do worker, o agendador `abandoned-uploads-sweep` existe na fila `video-maintenance`

---

### SI-03.14 — Endpoint GET /videos/{public_id}

**Route:** GET /videos/{public_id}
**Test Specs:** see `nestjs-project/specs/videos-get.plan.md`
**Authorization:** Anonymous — endpoint `@Public()`, só serve vídeo `ready` (per `### Authorization Matrix`)

**Description:** Resolve um vídeo pelo identificador de URL única e devolve seus metadados públicos quando ele está pronto.

**Technical actions:**

1. Adicionar `VideoNotReadyException` a `src/common/exceptions/domain.exception.ts` (per Error Catalog)
2. Criar `src/videos/videos.service.ts` com `getReadyVideo(publicId)`: busca por `public_id`, lança `VideoNotFoundException` quando não existe e `VideoNotReadyException` quando o status não é `ready` (per `phase-03-videos/TD-06`, `phase-03-videos/TD-07`)
3. Criar `src/videos/dto/video-response.dto.ts` (`public_id`, `title`, `status`, `duration_seconds`, `width`, `height`, `created_at`)
4. Adicionar `GET :publicId` em `VideosController` com `@Public()`, `@ApiResponse` dos erros 404 e 409 e delegando ao service (per `.claude/rules/nestjs-controllers.md`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.getReadyVideo` | Unit: pronto, não pronto e inexistente (repositório mockado) | `src/videos/videos.service.spec.ts` |
| `VideosService.getReadyVideo` | Integration: consulta por `public_id` no Postgres real | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.5 — entidade e repositório; SI-03.7 — `VideoNotFoundException`

**Acceptance criteria:**

- `GET /videos/{public_id}` de um vídeo `ready`, sem `Authorization`, retorna `200` com `public_id`, `title`, `status: "ready"`, `duration_seconds`, `width`, `height` e `created_at`
- `GET /videos/{public_id}` de um vídeo em `draft`, `processing` ou `error` retorna `409` com `error: "VIDEO_NOT_READY"`
- `GET /videos/{public_id}` com `public_id` inexistente retorna `404` com `error: "VIDEO_NOT_FOUND"`
- O `public_id` devolvido por `POST /videos` é o mesmo devolvido por `GET /videos/{public_id}` depois de o vídeo chegar a `ready`

---

### SI-03.15 — Endpoint GET /videos/{public_id}/stream

**Route:** GET /videos/{public_id}/stream
**Test Specs:** see `nestjs-project/specs/videos-stream.plan.md`
**Authorization:** Anonymous — endpoint `@Public()`, só serve vídeo `ready` (per `### Authorization Matrix`)

**Description:** Entrega o vídeo por streaming com requisições parciais (`Range`/206), transmitindo o objeto do storage sem carregar o arquivo inteiro na memória da API.

**Technical actions:**

1. Criar `src/videos/range.util.ts` que interpreta o cabeçalho `Range` de um único intervalo de bytes (`início-fim`, `início-` e `-sufixo`), ignora valores que não sejam um único intervalo e identifica intervalo não satisfatório para o tamanho total (per `phase-03-videos/TD-07`)
2. Criar `src/videos/video-streaming.service.ts` com `stream(publicId, rangeHeader)`: exige vídeo `ready`, chama `headObject` para o tamanho total, repassa o `Range` a `getObjectRange` e devolve status 200 ou 206, cabeçalhos (`Content-Type`, `Content-Length`, `Content-Range`, `Accept-Ranges`, `ETag`, `Cache-Control: no-cache`) e o `Body` em stream (per `phase-03-videos/TD-07`)
3. Adicionar `InvalidRangeException` (`INVALID_RANGE`, 416) a `src/common/exceptions/domain.exception.ts`; o controller responde o 416 com `Content-Range: bytes */{total}` e o envelope de erro (per Error Catalog)
4. Adicionar `GET :publicId/stream` em `VideosController` com `@Public()`, `@Res({ passthrough: true })` e `StreamableFile`, sem buffer do arquivo, e `@ApiResponse` dos erros 404, 409, 416 e 502 (per `.claude/rules/nestjs-controllers.md`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `parseRange` | Unit: intervalos válidos, aberto, sufixo, múltiplos e não satisfatório | `src/videos/range.util.spec.ts` |
| `VideoStreamingService.stream` | Unit: vídeo inexistente e não pronto (repositório e storage mockados) | `src/videos/video-streaming.service.spec.ts` |
| `VideoStreamingService.stream` | Integration: MinIO real — `Range` retorna 1024 bytes, sem `Range` devolve stream e o heap não cresce perto do tamanho do arquivo | `src/videos/video-streaming.service.integration-spec.ts` |

**Dependencies:** SI-03.14 — resolução por `public_id` e vídeo `ready`; SI-03.3 — leitura por intervalo

**Acceptance criteria:**

- `GET /videos/{public_id}/stream` com `Range: bytes=0-1023`, sem `Authorization`, retorna `206` com `Content-Range: bytes 0-1023/{total}`, `Content-Length: 1024` e exatamente 1024 bytes no corpo
- `GET /videos/{public_id}/stream` sem `Range` retorna `200` com `Accept-Ranges: bytes`, `Content-Length` igual ao tamanho do arquivo e corpo com o mesmo hash do arquivo original
- `GET /videos/{public_id}/stream` com `Range` além do tamanho do arquivo retorna `416` com `error: "INVALID_RANGE"` e `Content-Range: bytes */{total}`
- `GET /videos/{public_id}/stream` de um vídeo em `draft`, `processing` ou `error` retorna `409` com `error: "VIDEO_NOT_READY"`, e de `public_id` inexistente retorna `404` com `error: "VIDEO_NOT_FOUND"`
- Servir sem `Range` um arquivo de 200 MiB não faz o heap da API crescer perto do tamanho do arquivo (aumento inferior a 50 MiB)

---

### SI-03.16 — Endpoint GET /videos/{public_id}/download

**Route:** GET /videos/{public_id}/download
**Test Specs:** see `nestjs-project/specs/videos-download.plan.md`
**Authorization:** Anonymous — endpoint `@Public()`, só serve vídeo `ready` (per `### Authorization Matrix`)

**Description:** Permite baixar o arquivo completo do vídeo com nome de arquivo adequado, reaproveitando a leitura em stream do storage.

**Technical actions:**

1. Criar `src/videos/filename.util.ts` que monta o nome do download a partir do título saneado e da extensão da `video_key`, com `filename` ASCII e `filename*` para caracteres não ASCII (per `phase-03-videos/TD-07`)
2. Adicionar `download(publicId)` a `VideoStreamingService`: exige vídeo `ready`, lê o objeto inteiro por `getObjectRange` sem `Range` e devolve `Content-Type`, `Content-Length` e `Content-Disposition: attachment` com o nome montado (per `phase-03-videos/TD-07`)
3. Adicionar `GET :publicId/download` em `VideosController` com `@Public()`, `StreamableFile` e `@ApiResponse` dos erros 404, 409 e 502

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `buildDownloadFilename` | Unit: título com caracteres inseguros ou não ASCII e extensão | `src/videos/filename.util.spec.ts` |
| `VideoStreamingService.download` | Integration: MinIO real — o corpo baixado tem o mesmo hash do arquivo original | `src/videos/video-download.integration-spec.ts` |

**Dependencies:** SI-03.15 — leitura em stream e serviço de streaming

**Acceptance criteria:**

- `GET /videos/{public_id}/download` de um vídeo `ready`, sem `Authorization`, retorna `200` com o arquivo íntegro (mesmo hash do original) e `Content-Length` igual ao tamanho do arquivo
- A resposta traz `Content-Disposition: attachment; filename="<título>.<ext>"`, com caracteres inseguros do título saneados
- `GET /videos/{public_id}/download` de um vídeo em `draft`, `processing` ou `error` retorna `409` com `error: "VIDEO_NOT_READY"`
- `GET /videos/{public_id}/download` com `public_id` inexistente retorna `404` com `error: "VIDEO_NOT_FOUND"`

---

### SI-03.17 — Publicar o contrato OpenAPI e os exemplos de requisição dos vídeos

**Description:** Deixa os sete endpoints de vídeo documentados no OpenAPI exportado e nos exemplos de requisição do projeto, seguindo as decisões de documentação de API herdadas.

**Technical actions:**

1. Conferir que os DTOs de `src/videos/dto/` e os decoradores do `VideosController` alimentam o plugin do `@nestjs/swagger` (`classValidatorShim`) e que cada endpoint tem `@ApiTags('videos')`, `@ApiResponse` dos erros com `ApiErrorEnvelope` e `@ApiBearerAuth('access-token')` nos protegidos (per `openapi-docs-nestjs/TD-01`)
2. Executar `npm run openapi:export` dentro do container e versionar o `nestjs-project/openapi.json` regenerado (per `openapi-docs-nestjs/TD-02`)
3. Acrescentar em `nestjs-project/api.http` o fluxo de vídeos: `POST /videos`, `GET .../upload`, `POST .../upload/parts`, `PUT` de uma parte na URL retornada, `POST .../upload/completion`, `GET /videos/{public_id}`, `GET .../stream` com `Range` e `GET .../download`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| exportação do OpenAPI | Integration: o documento exportado contém os sete caminhos de vídeo e a exportação é idempotente | `src/openapi-export.integration-spec.ts` |

**Dependencies:** SI-03.16 — todos os endpoints de vídeo existem

**Acceptance criteria:**

- O `openapi.json` versionado contém os caminhos `/videos`, `/videos/{public_id}`, `/videos/{public_id}/upload`, `/videos/{public_id}/upload/parts`, `/videos/{public_id}/upload/completion`, `/videos/{public_id}/stream` e `/videos/{public_id}/download`
- Rodar `npm run openapi:export` de novo não produz diferença no `openapi.json`
- Com o Swagger habilitado em desenvolvimento, a interface agrupa os sete endpoints sob a tag `videos`
- O `api.http` traz um exemplo executável para cada um dos sete endpoints

---

### SI-03.18 — Provar o upload de 10GB sem travar a API (script e evidência manual)

**Description:** Entrega o script que executa o fluxo completo de upload de um arquivo de 10 GiB direto ao storage, medindo a resposta da API durante o envio, e registra a evidência que o PRD 02 exige no `progress.md`.

**Technical actions:**

1. Criar `nestjs-project/scripts/upload-large-video.mjs`, executado dentro do container com `docker compose exec nestjs-api node scripts/upload-large-video.mjs <arquivo>`: cadastra e confirma um usuário de teste pelo fluxo de autenticação existente (o e-mail de confirmação é lido no Mailpit), faz login, chama `POST /videos`, envia as partes em paralelo por `PUT` nas URLs de `POST .../upload/parts` lendo o arquivo por fatias e chama `POST .../upload/completion` (per `phase-03-videos/TD-02`)
2. Fazer o mesmo script sondar `GET /` da API em intervalos curtos durante todo o envio e imprimir a latência máxima e a taxa de respostas 200
3. Documentar no `progress.md` o passo exato: gerar o arquivo esparso com `truncate -s 10G` dentro do diretório montado no contêiner, garantir 10 GiB livres no volume do MinIO (o storage grava os bytes) e rodar o script contra o Compose
4. Registrar no `progress.md` a saída do script, o status final do vídeo (`ready` ou `error`, sendo `error` com `INVALID_MEDIA` esperado para um arquivo esparso que não é um MP4 válido) e a observação de que o tráfego do arquivo não passa pelo contêiner da API

**Tests:** _(empty — prova manual; a evidência fica registrada no `progress.md`)_

**Dependencies:** SI-03.2 — storage e fila no Compose; SI-03.9 — fluxo de upload; SI-03.12 — desfecho do processamento

**Acceptance criteria:**

- Com um arquivo esparso de 10 GiB, `POST /videos` retorna `201` com `part_count` igual a 160 e o vídeo nasce como `draft`
- Durante o envio das partes, `GET /` da API continua retornando `200` e o script registra a latência máxima observada
- Depois de `POST .../upload/completion` retornar `202`, o vídeo chega a `ready` ou `error` e o resultado, com a saída do script, fica registrado no `progress.md`
- Durante o envio, o tráfego de rede do contêiner `nestjs-api` medido com `docker stats` é desprezível perto dos 10 GiB enviados ao storage

---

### SI-03.19 — Atualizar CLAUDE.md e o diagrama de arquitetura e fechar a Definition of Done

**Description:** Deixa a documentação de IA fiel ao código real da fase e executa a Definition of Done completa do projeto, registrando as saídas no `progress.md`.

**Technical actions:**

1. Atualizar o `CLAUDE.md` da raiz com a seção de vídeos: fila BullMQ sobre Redis no lugar de "TBD", upload direto ao storage por multipart pré-assinado, streaming e download servidos pela API, imagem do MinIO fixada no `quay.io` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`, `phase-03-videos/TD-07`, `phase-03-videos/TD-10`)
2. Atualizar `nestjs-project/CLAUDE.md` com o módulo `videos`, os sete endpoints, a fila e o worker, o storage, os serviços `minio`, `minio-init`, `redis` e `video-worker`, as verificações de prontidão de Redis e MinIO ao lado de `pg_isready`, a regra de inicialização ajustada para tratar o worker como infraestrutura (continua valendo para o servidor da API) e a correspondência dos status `draft`, `processing`, `ready` e `error` com rascunho, processando, pronto e erro
3. Atualizar `docs/diagrams/software-arch.mermaid` para refletir o fluxo implementado (fila BullMQ/Redis, cliente enviando partes ao storage, API servindo streaming)
4. Rodar dentro do container a suíte completa (`npm test -- --runInBand` e `npm run test:e2e`), `npx tsc --noEmit` e `npm run lint`, e anexar as saídas ao `progress.md`
5. Revisar item a item os dois `CLAUDE.md` contra o código e o `compose.yaml`, sem deixar referência a arquivo, endpoint ou comportamento inexistente

**Tests:** _(empty — documentação e fechamento; a verificação é a Definition of Done)_

**Dependencies:** SI-03.13 — sweeper; SI-03.17 — contrato OpenAPI; SI-03.18 — prova de 10GB

**Acceptance criteria:**

- Todo arquivo, endpoint, script, comando e serviço citado nos dois `CLAUDE.md` existe no código ou no `compose.yaml`
- `docker compose exec nestjs-api npm test -- --runInBand` e `docker compose exec nestjs-api npm run test:e2e` terminam com código 0 e sem testes falhando
- `docker compose exec nestjs-api npx tsc --noEmit` termina com código 0 e `docker compose exec nestjs-api npm run lint` passa
- `docs/diagrams/software-arch.mermaid` não contém mais "TBD" para a fila e descreve o envio de partes direto ao storage
- `git log main` não contém commits diretos desta fase, e a branch `feature/phase-03-videos` parte da `dev`

---

## Technical Specifications

### Data Model

#### Video (tabela `videos`, SI-03.5)

Nomes de coluna marcados como (TD) vêm literalmente do documento de decisões; os demais são definidos por este plano (o enunciado delega o modelo exato ao Data Model).

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, generated (`uuid_generate_v4()`, como `users` e `channels`) |
| public_id | varchar(11) | unique, not null, imutável após o insert — 11 caracteres de alfabeto URL-safe gerados com `crypto.randomBytes` (per `phase-03-videos/TD-06`) |
| channel_id | uuid | not null, FK → `channels.id` (vídeo pertence a um canal) |
| title | varchar(100) | not null — título inicial derivado do nome do arquivo sem extensão, truncado em 100 caracteres (per `phase-03-videos/TD-02`; o limite de 100 caracteres é definido por este plano) |
| status | varchar(16) | not null, default `draft`, CHECK `status IN ('draft','processing','ready','error')` (per `phase-03-videos/TD-08`) |
| video_key | varchar(1024) | not null — chave do arquivo no bucket `videos`: `{channelId}/{videoId}/source.{ext}` (per `phase-03-videos/TD-09`) |
| thumbnail_key | varchar(1024) | null até o processamento — chave no bucket `thumbnails`: `{videoId}/default.jpg` (per `phase-03-videos/TD-09`) |
| upload_id | varchar(1024) | null — `UploadId` do multipart enquanto o upload está em andamento; volta a `NULL` no mesmo UPDATE que preenche `upload_completed_at` (per `phase-03-videos/TD-02`) |
| upload_completed_at | timestamp | null — nulo = upload em andamento; preenchido = upload concluído aguardando o worker (per `phase-03-videos/TD-08`, Revision de 2026-09-20) |
| duration_seconds | numeric(12,3) | null até o processamento (per `phase-03-videos/TD-05`) |
| width | integer | null até o processamento (per `phase-03-videos/TD-05`) |
| height | integer | null até o processamento (per `phase-03-videos/TD-05`) |
| video_codec | varchar(64) | null até o processamento (per `phase-03-videos/TD-05`) |
| audio_codec | varchar(64) | null — também nulo para vídeo sem trilha de áudio (per `phase-03-videos/TD-05`) |
| bit_rate | bigint | null até o processamento (per `phase-03-videos/TD-05`) |
| format_name | varchar(128) | null até o processamento (per `phase-03-videos/TD-05`) |
| size_bytes | bigint | null até o processamento (per `phase-03-videos/TD-05`) |
| metadata | jsonb | null — saída do ffprobe reduzida (per `phase-03-videos/TD-05`) |
| error_code | varchar(64) | null — preenchido quando `status = 'error'` (per `phase-03-videos/TD-08`) |
| error_message | varchar(500) | null — mensagem curta da causa (per `phase-03-videos/TD-08`) |
| created_at | timestamp | not null, default now() |
| updated_at | timestamp | not null, default now() |

**Relations:** `Video` many-to-one `Channel` via `channel_id` (sem cascade; vídeos pertencem ao canal do usuário autenticado).
**Indexes:** unique em `public_id` (`UQ_videos_public_id`, arbitra colisões concorrentes); index em `channel_id`; index em (`status`, `created_at`) para as consultas do sweeper (per `phase-03-videos/TD-03`).
**Transições de status** (todas por `UPDATE … WHERE id = $1 AND status = <esperado>`, compare-and-set, per `phase-03-videos/TD-08`):

- `draft` → `processing`: worker, exige `upload_completed_at IS NOT NULL`.
- `processing` → `processing`: reentrada em retentativa/redelivery do mesmo job.
- `processing` → `ready` | `error`: worker ao terminar (com `error_code` e `error_message` em `error`).
- `ready` e `error` são terminais nesta fase; uma transição inválida atualiza 0 linhas e é tratada como no-op pelo worker (job de vídeo já `ready` é confirmado sem reprocessar) ou como erro de domínio pela API.

**Migration:** `<timestamp>-CreateVideos.ts`, reversível (`down` remove a tabela, os índices e a FK).

### API Contracts

Os caminhos usam o `public_id` (per `phase-03-videos/TD-06`) e modelam o handshake de upload como recursos, não verbos (per `phase-03-videos/TD-02`). Envelope de erro herdado: `{ statusCode, error, message }`, com `error` = código de domínio (per `phase-02-auth/TD-07`).

#### POST /videos (SI-03.6)

**Request headers:**
- Authorization: Bearer `<access_token>`
- Content-Type: application/json

**Request body:**
- filename: string, required — nome original do arquivo; a extensão deve estar em {`mp4`, `mov`, `mkv`, `webm`}
- content_type: string, required — um de {`video/mp4`, `video/quicktime`, `video/x-matroska`, `video/webm`}, coerente com a extensão
- size_bytes: integer, required — de 1 até 10737418240 (10 GiB)

**Response 201:**
- public_id: string — identificador de URL única (11 caracteres)
- status: string — `draft`
- part_size_bytes: integer — 67108864 (64 MiB) por padrão, definido pelo servidor e nunca pelo cliente (per `phase-03-videos/TD-02`); a chave de ambiente `VIDEO_UPLOAD_PART_SIZE_BYTES` (mínimo 5242880, o piso do S3) existe para que os testes de integração usem partes pequenas — escolha deste plano
- part_count: integer — `ceil(size_bytes / part_size_bytes)`

**Error responses:**
- 400 validation error: quando o corpo viola o schema de validação
- 401 unauthorized: sem `Authorization` válido (requisição anônima é rejeitada)
- 404 CHANNEL_NOT_FOUND: quando o usuário autenticado não tem canal
- 413 VIDEO_TOO_LARGE: quando `size_bytes` excede 10 GiB
- 415 UNSUPPORTED_VIDEO_FORMAT: quando extensão ou `content_type` está fora da allowlist ou são incoerentes entre si
- 502 STORAGE_UNAVAILABLE: quando o storage não responde ao iniciar o multipart

---

#### GET /videos/{public_id}/upload (SI-03.7)

**Request headers:**
- Authorization: Bearer `<access_token>`

**Response 200:**
- public_id: string
- status: string — `draft`, `processing`, `ready` ou `error`
- upload_completed: boolean — `true` quando `upload_completed_at` está preenchido
- part_size_bytes: integer — o mesmo tamanho de parte informado na criação do vídeo
- uploaded_parts: array de `{ part_number: integer, size_bytes: integer }` — partes já presentes no storage (resume); vazio quando `upload_completed` é `true`

**Error responses:**
- 401 unauthorized: sem `Authorization` válido
- 403 VIDEO_ACCESS_DENIED: quando o vídeo pertence a outro canal
- 404 VIDEO_NOT_FOUND: quando não existe vídeo com o `public_id`
- 502 STORAGE_UNAVAILABLE: quando o storage não responde ao listar as partes

---

#### POST /videos/{public_id}/upload/parts (SI-03.8)

**Request headers:**
- Authorization: Bearer `<access_token>`
- Content-Type: application/json

**Request body:**
- part_numbers: array de integer, required — de 1 a 100 itens (limite definido por este plano), cada um de 1 a 10000, sem repetição

**Response 201:**
- parts: array de `{ part_number: integer, url: string }` — URL pré-assinada de `UploadPart` para cada parte pedida
- expires_in: integer — 3600 (segundos de validade das URLs)

**Error responses:**
- 400 validation error: quando `part_numbers` viola o schema
- 401 unauthorized: sem `Authorization` válido
- 403 VIDEO_ACCESS_DENIED: quando o vídeo pertence a outro canal
- 404 VIDEO_NOT_FOUND: quando não existe vídeo com o `public_id`
- 409 UPLOAD_ALREADY_COMPLETED: quando `upload_completed_at` já está preenchido
- 502 STORAGE_UNAVAILABLE: quando o storage não responde

---

#### POST /videos/{public_id}/upload/completion (SI-03.9)

**Request headers:**
- Authorization: Bearer `<access_token>`

**Response 202:**
- public_id: string
- status: string — `draft` (o worker o move para `processing`)
- upload_completed: boolean — `true`

A chamada é idempotente: repetir a confirmação de um upload já concluído devolve a mesma resposta 202 sem completar o multipart de novo nem gerar outro job.

**Error responses:**
- 401 unauthorized: sem `Authorization` válido
- 403 VIDEO_ACCESS_DENIED: quando o vídeo pertence a outro canal
- 404 VIDEO_NOT_FOUND: quando não existe vídeo com o `public_id`
- 409 UPLOAD_INCOMPLETE: quando as partes listadas não formam a sequência contígua 1..N, ou alguma parte que não é a última difere de `part_size_bytes`
- 413 VIDEO_TOO_LARGE: quando a soma dos tamanhos das partes excede 10 GiB (o multipart é abortado e o rascunho removido)
- 502 STORAGE_UNAVAILABLE: quando o storage não responde ao listar ou completar

---

#### GET /videos/{public_id} (SI-03.14)

**Request headers:** nenhum obrigatório (endpoint público).

**Response 200:**
- public_id: string
- title: string
- status: string — `ready`
- duration_seconds: number
- width: integer
- height: integer
- created_at: string (ISO 8601)

**Error responses:**
- 404 VIDEO_NOT_FOUND: quando não existe vídeo com o `public_id`
- 409 VIDEO_NOT_READY: quando o vídeo está em `draft`, `processing` ou `error`

---

#### GET /videos/{public_id}/stream (SI-03.15)

**Request headers:**
- Range: bytes=`start`-`end`, opcional — um único intervalo; um `Range` que não seja um único intervalo de bytes é ignorado (resposta 200 completa)

**Response 200** (sem `Range`): corpo transmitido em stream, sem carregar o arquivo na memória da API.
- Content-Type: o tipo do objeto no storage
- Content-Length: tamanho total em bytes
- Accept-Ranges: bytes
- ETag: o do objeto no storage
- Cache-Control: no-cache (valor definido por este plano: até a Fase 04 trazer visibilidade, nenhuma cache intermediária deve reter o vídeo)

**Response 206** (com `Range` satisfatório): apenas o trecho pedido, mesmos cabeçalhos mais:
- Content-Range: `bytes {start}-{end}/{total}`
- Content-Length: `end - start + 1`

**Error responses:**
- 404 VIDEO_NOT_FOUND: quando não existe vídeo com o `public_id`
- 409 VIDEO_NOT_READY: quando o vídeo está em `draft`, `processing` ou `error`
- 416 INVALID_RANGE: quando o intervalo não é satisfatório (resposta com `Content-Range: bytes */{total}`)
- 502 STORAGE_UNAVAILABLE: quando o storage não responde

---

#### GET /videos/{public_id}/download (SI-03.16)

**Request headers:** nenhum obrigatório (endpoint público).

**Response 200:** arquivo completo transmitido em stream.
- Content-Type: o tipo do objeto no storage
- Content-Length: tamanho total em bytes
- Content-Disposition: `attachment; filename="{title}.{ext}"` (nome saneado, com `filename*` para caracteres não ASCII)

**Error responses:**
- 404 VIDEO_NOT_FOUND: quando não existe vídeo com o `public_id`
- 409 VIDEO_NOT_READY: quando o vídeo está em `draft`, `processing` ou `error`
- 502 STORAGE_UNAVAILABLE: quando o storage não responde

---

#### Validation Rules — vídeos

- Formato de fio: JSON em `snake_case`, como `access_token` e `refresh_token` da autenticação.
- `filename`: obrigatório, string não vazia; extensão em {`mp4`, `mov`, `mkv`, `webm`} (per `phase-03-videos/TD-02`).
- `content_type`: obrigatório; deve corresponder à extensão (`mp4` → `video/mp4`, `mov` → `video/quicktime`, `mkv` → `video/x-matroska`, `webm` → `video/webm`).
- `size_bytes`: obrigatório, inteiro ≥ 1; o limite de 10 GiB é regra de domínio (413), não de schema.
- `part_numbers`: 1 a 100 inteiros distintos entre 1 e 10000 (o teto de 100 por chamada é definido por este plano; o de 10000 é o limite do S3/MinIO).
- O canal do vídeo vem sempre do usuário autenticado (`sub` do JWT), nunca do corpo da requisição (per `phase-03-videos/TD-02`).
- A validade final do arquivo de vídeo é decidida pelo ffprobe no worker, não pela extensão (per `phase-03-videos/TD-05`).

### Authorization Matrix

O guard JWT é global (`APP_GUARD`) e todo endpoint é protegido por padrão; os três endpoints públicos optam por sair com `@Public()` (per `phase-02-auth/TD-02`). "Owner" é o usuário cujo canal é dono do vídeo (`channels.user_id` = `sub` do JWT); a verificação vive no service, não no guard.

| Endpoint | Anonymous | Authenticated | Owner |
|----------|-----------|---------------|-------|
| POST /videos | ✗ | ✓ (cria no próprio canal) | ✓ |
| GET /videos/{public_id}/upload | ✗ | ✗ (403 VIDEO_ACCESS_DENIED) | ✓ |
| POST /videos/{public_id}/upload/parts | ✗ | ✗ (403 VIDEO_ACCESS_DENIED) | ✓ |
| POST /videos/{public_id}/upload/completion | ✗ | ✗ (403 VIDEO_ACCESS_DENIED) | ✓ |
| GET /videos/{public_id} | ✓ (`@Public()`, só `ready`) | ✓ | ✓ |
| GET /videos/{public_id}/stream | ✓ (`@Public()`, só `ready`) | ✓ | ✓ |
| GET /videos/{public_id}/download | ✓ (`@Public()`, só `ready`) | ✓ | ✓ |

Até a Fase 04 trazer publicação e visibilidade, qualquer vídeo `ready` é alcançável por quem tiver o `public_id`, como um vídeo "não listado" (per `phase-03-videos/TD-07`); a Fase 04 acrescenta o bloqueio dos não publicados.

### Error Catalog

O formato de resposta de erro é o herdado da Fase 02: `{ statusCode, error, message }` com `error` = `errorCode` (per `phase-02-auth/TD-07`). Cada linha abaixo é uma subclasse de `DomainException` em `src/common/exceptions/domain.exception.ts`.

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| CHANNEL_NOT_FOUND | 404 | Início de upload por usuário autenticado sem canal |
| VIDEO_NOT_FOUND | 404 | `public_id` inexistente em qualquer endpoint de vídeo |
| VIDEO_ACCESS_DENIED | 403 | Endpoint de sessão de upload chamado por usuário que não é dono do vídeo |
| VIDEO_NOT_READY | 409 | Metadados, stream ou download de vídeo em `draft`, `processing` ou `error` |
| UPLOAD_ALREADY_COMPLETED | 409 | Pedido de URLs de partes depois de `upload_completed_at` preenchido |
| UPLOAD_INCOMPLETE | 409 | Confirmação de conclusão com partes ausentes, fora de sequência ou com tamanho diferente de `part_size_bytes` antes da última |
| VIDEO_TOO_LARGE | 413 | `size_bytes` acima de 10 GiB no início, ou soma das partes acima de 10 GiB na conclusão |
| UNSUPPORTED_VIDEO_FORMAT | 415 | Extensão ou `content_type` fora da allowlist, ou incoerentes entre si |
| INVALID_RANGE | 416 | `Range` de um único intervalo que não é satisfatório para o tamanho do arquivo |
| STORAGE_UNAVAILABLE | 502 | Falha de comunicação com o object storage numa chamada síncrona da API |

Códigos gravados em `videos.error_code` pelo worker quando o vídeo termina em `error` (per `phase-03-videos/TD-08`); não são respostas HTTP:

| error_code | Retentável | Trigger |
|------------|------------|---------|
| INVALID_MEDIA | não | O ffprobe não consegue interpretar o arquivo (corrompido, sem trilha de vídeo ou formato inválido) — vai direto a `error` com `UnrecoverableError` |
| PROCESSING_FAILED | sim, até 3 tentativas | Falha transitória (storage, rede, banco) que esgotou as retentativas; o job vai para a DLQ |

### Events/Messages

Broker: BullMQ sobre o serviço `redis` do Compose (per `phase-03-videos/TD-01`). Nomes de fila e de job são definidos por este plano; o payload `{videoId}`, o `jobId = videoId`, o limite de 3 tentativas com backoff exponencial e a DLQ vêm do documento de decisões. Todas as filas usam o `redis` configurado com AOF e `maxmemory-policy noeviction` (per `phase-03-videos/TD-01`).

#### video-processing / process-video

**Payload:**

```json
{ "videoId": "uuid" }
```

**Producer:** `VideoProcessingPublisher`, chamado por `VideoUploadsService` logo após o commit do banco na confirmação de conclusão do upload (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`); republicado pelo sweeper para vídeos com upload concluído que nunca saíram de `draft` (per `phase-03-videos/TD-03`)
**Consumer:** `VideoProcessor` no worker (per `phase-03-videos/TD-04`, `phase-03-videos/TD-08`)
**Trigger:** upload multipart concluído (`upload_completed_at` preenchido); o worker move o vídeo para `processing`, extrai metadados, gera o thumbnail e move para `ready` ou `error`
**Delivery semantics:** at-least-once. O job é publicado com `jobId = videoId` (publicar duas vezes não duplica o job), `attempts: 3` e `backoff: { type: 'exponential', delay: 5000 }` (o atraso base de 5000 ms é definido por este plano); o consumidor é idempotente por transições compare-and-set, e um vídeo já `ready` faz o job terminar sem reprocessar (per `phase-03-videos/TD-08`). Erro definitivo (`INVALID_MEDIA`) é lançado como `UnrecoverableError`; erro transitório é lançado normalmente para acionar as tentativas.

#### video-processing-dlq / dead-lettered-video

**Payload:**

```json
{ "videoId": "uuid", "failedReason": "string", "attemptsMade": 3 }
```

**Producer:** manipulador do evento `failed` do `VideoProcessor`, quando as tentativas se esgotam (per `phase-03-videos/TD-08`)
**Consumer:** nenhum nesta fase — a fila existe para inspeção dos jobs mortos (DLQ observável); o mesmo manipulador grava `status = 'error'` e `error_code = 'PROCESSING_FAILED'` no vídeo
**Trigger:** job de `video-processing` que esgotou as 3 tentativas por falha transitória
**Delivery semantics:** at-least-once, sem retentativa própria (per `phase-03-videos/TD-08`)

#### video-maintenance / sweep-abandoned-uploads

**Payload:**

```json
{}
```

**Producer:** agendador de jobs do BullMQ (`upsertJobScheduler` com id `abandoned-uploads-sweep`, intervalo de 15 minutos definido por este plano), registrado na inicialização do worker (per `phase-03-videos/TD-03`)
**Consumer:** `UploadsSweeper` no worker (per `phase-03-videos/TD-03`)
**Trigger:** a cada execução do agendador — aborta o multipart e remove o rascunho de vídeos com `upload_completed_at` nulo há mais de 24 h, e republica em `video-processing` os vídeos em `draft` com `upload_completed_at` preenchido há mais de 5 minutos (carência definida por este plano)
**Delivery semantics:** at-least-once e idempotente — abortar um multipart já removido e republicar com o mesmo `jobId` não têm efeito adicional (per `phase-03-videos/TD-03`)

---

## Dependency Map

```
SI-03.1 (root — dependências, configs e variáveis de ambiente)
└── SI-03.2 — depende de SI-03.1 (as chaves de ambiente alimentam o Compose)
    ├── SI-03.3 — depende de SI-03.1 + SI-03.2 (StorageService precisa do MinIO)
    │   ├── SI-03.6 — depende de SI-03.3 + SI-03.5 (abre o multipart e cria o rascunho)
    │   │   └── SI-03.7 — depende de SI-03.6 (vídeo e multipart precisam existir)
    │   │       ├── SI-03.8 — depende de SI-03.7 (verificação de dono e sessão de upload)
    │   │       │   └── SI-03.9 — depende de SI-03.8 + SI-03.4 (conclusão publica o job)
    │   │       │       ├── SI-03.13 — depende de SI-03.9 + SI-03.11 (sweeper usa o marcador e o worker)
    │   │       │       └── SI-03.18 — depende de SI-03.2 + SI-03.9 + SI-03.12 (prova de 10GB)
    │   │       └── SI-03.14 — depende de SI-03.5 + SI-03.7 (metadados do vídeo pronto)
    │   │           └── SI-03.15 — depende de SI-03.14 + SI-03.3 (streaming por intervalo)
    │   │               └── SI-03.16 — depende de SI-03.15 (download reaproveita o streaming)
    │   │                   └── SI-03.17 — depende de SI-03.16 (todos os endpoints existem)
    │   │                       └── SI-03.19 — depende de SI-03.13 + SI-03.17 + SI-03.18 (documentação e DoD)
    │   └── SI-03.10 — depende de SI-03.2 + SI-03.3 (FFmpeg na imagem e URL pré-assinada)
    │       └── SI-03.11 — depende de SI-03.4 + SI-03.5 + SI-03.10 (worker e processor)
    │           └── SI-03.12 — depende de SI-03.11 (falhas, DLQ e idempotência)
    └── SI-03.4 — depende de SI-03.1 + SI-03.2 (filas precisam do Redis)
SI-03.5 (root, independente — migration, entidade e repositório)
```

A árvore mostra cada SI sob um único pai; as dependências adicionais (mais de um pai) estão ditas em cada linha e na linha `**Dependencies:**` do próprio SI.

---

## Deliverables

- [x] SI-03.1 — Configurar dependências, namespaces de config e variáveis de ambiente de storage e fila
- [x] SI-03.2 — Infra: subir MinIO, buckets e Redis no Compose e instalar FFmpeg na imagem dev
- [x] SI-03.3 — Implementar StorageModule com StorageService
- [x] SI-03.4 — Implementar QueueModule com as filas BullMQ
- [x] SI-03.5 — Criar migration, entidade Video e repositório
- [x] SI-03.6 — Endpoint POST /videos
- [x] SI-03.7 — Endpoint GET /videos/{public_id}/upload
- [x] SI-03.8 — Endpoint POST /videos/{public_id}/upload/parts
- [x] SI-03.9 — Endpoint POST /videos/{public_id}/upload/completion
- [x] SI-03.10 — Implementar MediaProbeService e ThumbnailService com ffprobe e ffmpeg
- [x] SI-03.11 — Criar o worker e o VideoProcessor (caminho feliz)
- [x] SI-03.12 — Tratar falhas, retentativas, DLQ e idempotência no worker
- [x] SI-03.13 — Implementar o sweeper de uploads abandonados e a republicação de jobs
- [x] SI-03.14 — Endpoint GET /videos/{public_id}
- [x] SI-03.15 — Endpoint GET /videos/{public_id}/stream
- [x] SI-03.16 — Endpoint GET /videos/{public_id}/download
- [x] SI-03.17 — Publicar o contrato OpenAPI e os exemplos de requisição dos vídeos
- [x] SI-03.18 — Provar o upload de 10GB sem travar a API (script e evidência manual)
- [x] SI-03.19 — Atualizar CLAUDE.md e o diagrama de arquitetura e fechar a Definition of Done

**Full test suites:**

- [x] Backend tests pass (`cd nestjs-project && docker compose exec nestjs-api npm test -- --runInBand`)
- [x] E2E tests pass (`cd nestjs-project && docker compose exec nestjs-api npm run test:e2e`)
- [x] Type/compilation checks pass (`cd nestjs-project && docker compose exec nestjs-api npx tsc --noEmit`)
- [x] Lint passes (`cd nestjs-project && docker compose exec nestjs-api npm run lint`)
