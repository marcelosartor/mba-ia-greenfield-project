# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 3/19 completed

### SI-03.1 — Configurar dependências, namespaces de config e variáveis de ambiente de storage e fila
- **Status:** completed
- **Tests:** 20 passing (env.validation.integration-spec 13, storage.config.spec 3, redis.config.spec 4); `npx tsc --noEmit` exit 0; eslint dos arquivos do SI exit 0
- **Observations:**
  - Dependências instaladas dentro do container: `bullmq@6.3.8`, `@nestjs/bullmq@11.0.5` (CommonJS; a 12.x é ESM-only), `@aws-sdk/client-s3@3.1136.0` e `@aws-sdk/s3-request-presigner@3.1136.0`.
  - Padrões escolhidos pelo plano, não fixados por TD: `STORAGE_REGION=us-east-1` (o SDK exige região) e `VIDEO_PROCESSING_TIMEOUT_MS=1800000` (30 min).
  - `STORAGE_ACCESS_KEY_ID` e `STORAGE_SECRET_ACCESS_KEY` passam a ser obrigatórias na validação de ambiente; o `.env` local (ignorado pelo git) recebeu as chaves novas, e quem clonar o repositório precisa copiá-las do `.env.example`.
  - O comentário do `.env.example` foi escrito sem a palavra "localhost" para que a checagem por grep do critério não dê falso positivo.
  - `npm install` reportou 40 vulnerabilidades no audit do conjunto de dependências (preexistentes na árvore do projeto); tratar `npm audit` é fora do escopo deste SI.

### SI-03.2 — Infra: subir MinIO, buckets e Redis no Compose e instalar FFmpeg na imagem dev
- **Status:** completed
- **Tests:** no tests (Infra); critérios verificados por comando contra a stack no ar: `docker compose ps` (minio e redis saudáveis, `minio-init` Exited (0), nestjs-api em execução), `ffprobe -version`, buckets `videos` e `thumbnails` listados por cliente S3 em `http://minio:9000`, `redis-cli config get maxmemory-policy` = `noeviction`, `grep` de `localhost`/`127.0.0.1` sem ocorrências
- **Observations:**
  - Imagem do storage: `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` (confirmada com `minio --version`). A imagem do `mc` foi fixada por digest, não por tag: `quay.io/minio/mc@sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727` (release `RELEASE.2025-08-13T08-35-41Z`).
  - Evidência para o TD-10 (imagem removida do Docker Hub, presente no quay.io): `docker manifest inspect minio/minio:RELEASE.2025-09-07T16-13-09Z` falhou e `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` e `quay.io/minio/mc:latest` resolveram, em 2026-09-20.
  - FFmpeg vem do `apt` do Debian 12 (bookworm): `ffmpeg`/`ffprobe` 5.1.9-0+deb12u1. Isso confirma a afirmação do TD-04/TD-05 que não veio da doc consultada.
  - `redis:7` resolveu para o Redis 7.4.11, com `--appendonly yes --maxmemory-policy noeviction`.
  - O healthcheck do MinIO usa `mc ready local` (a imagem já traz o `mc`), o que evita escrever `localhost` no `compose.yaml`.
  - Nenhuma porta de `minio` ou `redis` é publicada no host: o tráfego é só pela rede do Compose. O console do MinIO (porta 9001) não é publicado.
  - O `minio-init` é idempotente (`mc mb --ignore-existing`); ao rodar de novo ele imprime "Bucket created successfully" mesmo com o bucket já existente, mas termina com código 0 sem recriar nada.
  - O `compose.yaml` interpola `STORAGE_ACCESS_KEY_ID` e `STORAGE_SECRET_ACCESS_KEY` do `.env` para as credenciais raiz do MinIO; sem elas no `.env` o `minio` não sobe.
  - O serviço `video-worker` fica para o SI-03.11.

### SI-03.3 — Implementar StorageModule com StorageService
- **Status:** completed
- **Tests:** 12 passing (storage.service.spec 7, storage.module.spec 1, storage.service.integration-spec 4, esta contra o MinIO real do Compose); `npx tsc --noEmit` exit 0; eslint e prettier de `src/storage` sem problemas
- **Observations:**
  - Um teste falhou na primeira rodada (1 de 3 tentativas de correção usada): dentro do Jest o erro de DNS do Node vem de outro realm, o SDK o embrulha em `Error: AWS SDK error wrapper for Error: getaddrinfo EAI_AGAIN …` e perde o `code`. O mapeamento para `StorageUnavailableException` passou a olhar também a mensagem (`getaddrinfo`, `ECONNREFUSED`, etc.), e há um teste unitário para esse embrulho.
  - Só falhas de comunicação (erro de rede, timeout e resposta 5xx) viram `STORAGE_UNAVAILABLE` (502). Respostas 4xx do storage (`NoSuchUpload`, `NotFound`, `InvalidRange`, …) sobem intactas como `S3ServiceException`; os SIs que consomem o `StorageService` (03.6 a 03.9, 03.15) decidem o que fazer com elas.
  - `listParts` de um multipart abortado lança `NoSuchUpload` (404, não mapeado); `headObject` de objeto inexistente lança `NotFound`.
  - Os métodos de multipart usam sempre o bucket `videos`; `presignGetObject`, `putObject`, `headObject` e `getObjectRange` recebem o bucket como parâmetro (o `StorageService` expõe `videosBucket` e `thumbnailsBucket`).
  - A validação de `Range` (416) não fica no `StorageService`: `getObjectRange` repassa o intervalo ao storage, e o SI-03.15 confere o tamanho com `headObject` antes.
  - Os testes de integração gravam sob `test-storage/<uuid>/` nos buckets reais e apagam os objetos no `afterAll`; o multipart abortado não deixa objeto.
  - `ListPartsCommand`, `CompleteMultipartUploadCommand` e `AbortMultipartUploadCommand`, que o context7 não tinha devolvido, foram validados pelos tipos do SDK (`tsc`) e pelo teste de integração contra o MinIO real.

### SI-03.4 — Implementar QueueModule com as filas BullMQ
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.5 — Criar migration, entidade Video e repositório
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.6 — Endpoint POST /videos
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.7 — Endpoint GET /videos/{public_id}/upload
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.8 — Endpoint POST /videos/{public_id}/upload/parts
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.9 — Endpoint POST /videos/{public_id}/upload/completion
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.10 — Implementar MediaProbeService e ThumbnailService com ffprobe e ffmpeg
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.11 — Criar o worker e o VideoProcessor (caminho feliz)
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.12 — Tratar falhas, retentativas, DLQ e idempotência no worker
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.13 — Implementar o sweeper de uploads abandonados e a republicação de jobs
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.14 — Endpoint GET /videos/{public_id}
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.15 — Endpoint GET /videos/{public_id}/stream
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.16 — Endpoint GET /videos/{public_id}/download
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.17 — Publicar o contrato OpenAPI e os exemplos de requisição dos vídeos
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.18 — Provar o upload de 10GB sem travar a API (script e evidência manual)
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.19 — Atualizar CLAUDE.md e o diagrama de arquitetura e fechar a Definition of Done
- **Status:** pending
- **Tests:** —
- **Observations:** none
