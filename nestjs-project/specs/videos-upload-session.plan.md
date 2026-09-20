---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.7
target_file: test/videos-upload-session.e2e-spec.ts
---

# GET /videos/{public_id}/upload — Test Plan

## Application Overview

`GET /videos/{public_id}/upload` devolve o estado da sessão de upload para o dono do vídeo: quais partes já estão no storage (`uploaded_parts`, usado para retomar após falha de conexão), o `part_size_bytes` e se o upload já foi concluído (`upload_completed`). Só o dono (usuário cujo canal é dono do vídeo) pode consultar; outro usuário autenticado recebe `403`, `public_id` inexistente `404` e requisição sem token `401`.

## Test Scenarios

### 1. Consultar a sessão de upload

**Setup:** `beforeEach` limpa as tabelas com `cleanAllTables` e o bucket `videos` do MinIO real; módulo de teste `Test.createTestingModule({ imports: [AppModule] })` com o `ValidationPipe` e os filtros do `main.ts`; `VIDEO_UPLOAD_PART_SIZE_BYTES=5242880` (piso do S3) para permitir partes reais pequenas; usuários A (dono) e B (outro usuário), ambos com canal, cadastrados e confirmados, com seus `access_token`; um vídeo de A criado por `POST /videos` com `size_bytes` de 12000000 (3 partes).

#### 1.1. dono-lista-partes-enviadas

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller pede `POST /videos/{public_id}/upload/parts` como A com `{ "part_numbers": [1, 2] }` e envia por `PUT` 5242880 bytes em cada URL retornada
    - expect: os dois `PUT` são aceitos pelo storage
  2. API-caller envia `GET /videos/{public_id}/upload` como A
    - expect: status `200`
    - expect: `uploaded_parts` contém `{ "part_number": 1, "size_bytes": 5242880 }` e `{ "part_number": 2, "size_bytes": 5242880 }`
    - expect: `upload_completed` é `false` e `part_size_bytes` é `5242880`

#### 1.2. proibe-usuario-que-nao-e-dono

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia `GET /videos/{public_id}/upload` autenticado como B
    - expect: status `403`
    - expect: corpo com `error: "VIDEO_ACCESS_DENIED"`

#### 1.3. video-inexistente

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia `GET /videos/aaaaaaaaaaa/upload` autenticado como A (um `public_id` de 11 caracteres que não existe)
    - expect: status `404`
    - expect: corpo com `error: "VIDEO_NOT_FOUND"`

#### 1.4. rejeita-requisicao-anonima

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia `GET /videos/{public_id}/upload` sem o cabeçalho `Authorization`
    - expect: status `401`

#### 1.5. upload-concluido-nao-lista-partes

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia as três partes por `PUT` nas URLs de `POST /videos/{public_id}/upload/parts` como A e confirma com `POST /videos/{public_id}/upload/completion`
    - expect: a confirmação retorna `202`
  2. API-caller envia `GET /videos/{public_id}/upload` como A
    - expect: status `200`
    - expect: `upload_completed` é `true` e `uploaded_parts` é uma lista vazia
