---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.6
target_file: test/videos-create.e2e-spec.ts
---

# POST /videos — Test Plan

## Application Overview

`POST /videos` inicia um upload: cria o vídeo como rascunho (`status = 'draft'`) no canal do usuário autenticado e abre o multipart no storage, devolvendo `public_id`, `part_size_bytes` e `part_count`. O endpoint é protegido pelo guard JWT global; o canal vem sempre do `sub` do token, nunca do corpo. Formato fora da allowlist (`mp4`, `mov`, `mkv`, `webm`) e tamanho acima de 10 GiB são erros de domínio (`415` e `413`); falha do storage vira `502` sem deixar rascunho órfão.

## Test Scenarios

### 1. Iniciar o upload de um vídeo

**Setup:** `beforeEach` limpa as tabelas com `cleanAllTables` (inclui `videos`) e o bucket `videos` do MinIO real do Compose; o módulo de teste é `Test.createTestingModule({ imports: [AppModule] })` com o `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) e os filtros `DomainExceptionFilter` e `ValidationExceptionFilter` do `main.ts` reproduzidos; o usuário A (com canal) é cadastrado e confirmado por `AuthService` e seu `access_token` é obtido no login.

#### 1.1. cria-rascunho-e-multipart

**Covers AC:** #1, #2
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia `POST /videos` com `Authorization: Bearer <token de A>` e corpo `{ "filename": "a.mp4", "content_type": "video/mp4", "size_bytes": 200000000 }`
    - expect: status `201`
    - expect: `public_id` é uma string de 11 caracteres URL-safe, `status` é `"draft"`, `part_size_bytes` é `67108864` e `part_count` é `3`
  2. API-caller consulta a tabela `videos` pelo `public_id` devolvido
    - expect: existe exatamente uma linha com `status = 'draft'`, `channel_id` igual ao id do canal do usuário A e `upload_completed_at` nulo
    - expect: `upload_id` está preenchido e `video_key` segue `{channelId}/{videoId}/source.mp4`

#### 1.2. rejeita-requisicao-anonima

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia `POST /videos` sem o cabeçalho `Authorization` e com corpo válido
    - expect: status `401`
    - expect: nenhuma linha é criada em `videos`

#### 1.3. rejeita-tamanho-acima-de-10-gib

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia `POST /videos` autenticado como A com `size_bytes` igual a `10737418241`
    - expect: status `413`
    - expect: corpo com `error: "VIDEO_TOO_LARGE"`
    - expect: nenhuma linha é criada em `videos`

#### 1.4. rejeita-formato-fora-da-allowlist

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia `POST /videos` autenticado como A com `filename` `a.exe` e `content_type` `application/octet-stream`
    - expect: status `415`
    - expect: corpo com `error: "UNSUPPORTED_VIDEO_FORMAT"`
    - expect: nenhuma linha é criada em `videos`

#### 1.5. rejeita-channel-id-no-corpo

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia `POST /videos` autenticado como A com um corpo válido acrescido do campo `channel_id` de outro canal
    - expect: status `400` (o `ValidationPipe` com `forbidNonWhitelisted` rejeita o campo extra)
    - expect: nenhuma linha é criada em `videos`

#### 1.6. storage-indisponivel-nao-deixa-rascunho-orfao

**Covers AC:** #7
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. O módulo de teste é reconfigurado com o endpoint do storage apontando para um host inexistente (`http://storage-down:9000`) e API-caller envia `POST /videos` autenticado como A com corpo válido
    - expect: status `502`
    - expect: corpo com `error: "STORAGE_UNAVAILABLE"`
    - expect: nenhuma linha permanece em `videos` (o rascunho criado antes da chamada ao storage foi removido)
