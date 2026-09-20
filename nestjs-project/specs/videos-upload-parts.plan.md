---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.8
target_file: test/videos-upload-parts.e2e-spec.ts
---

# POST /videos/{public_id}/upload/parts — Test Plan

## Application Overview

`POST /videos/{public_id}/upload/parts` emite URLs pré-assinadas de `UploadPart` para as partes pedidas (`part_numbers`: 1 a 100 inteiros distintos entre 1 e 10000), com validade de 3600 s, para que o cliente envie os bytes direto ao storage sem passar pela API. Só o dono do vídeo pode pedir, e só enquanto o upload não foi concluído (depois disso, `409`).

## Test Scenarios

### 1. Pedir URLs de partes

**Setup:** `beforeEach` limpa as tabelas com `cleanAllTables` e o bucket `videos` do MinIO real; módulo de teste `Test.createTestingModule({ imports: [AppModule] })` com o `ValidationPipe` e os filtros do `main.ts`; `VIDEO_UPLOAD_PART_SIZE_BYTES=5242880`; usuários A (dono) e B (outro usuário), ambos com canal, cadastrados e confirmados, com seus `access_token`; um vídeo de A criado por `POST /videos` com `size_bytes` de 6000000 (2 partes).

#### 1.1. emite-urls-pre-assinadas

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia `POST /videos/{public_id}/upload/parts` como A com `{ "part_numbers": [1, 2] }`
    - expect: status `201`
    - expect: `parts` tem duas entradas com `part_number` 1 e 2 e uma `url` cada, e `expires_in` é `3600`

#### 1.2. storage-aceita-put-na-url-retornada

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller obtém a URL da parte 1 em `POST /videos/{public_id}/upload/parts` como A
    - expect: status `201`
  2. API-caller envia por `PUT` diretamente à `url` 5242880 bytes, sem o cabeçalho `Authorization`
    - expect: o storage responde com sucesso (`200`)
    - expect: a URL usa o host `minio` do Compose, não `localhost`

#### 1.3. rejeita-depois-da-conclusao

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia as duas partes por `PUT` e confirma com `POST /videos/{public_id}/upload/completion` como A
    - expect: a confirmação retorna `202`
  2. API-caller envia `POST /videos/{public_id}/upload/parts` como A com `{ "part_numbers": [1] }`
    - expect: status `409`
    - expect: corpo com `error: "UPLOAD_ALREADY_COMPLETED"`

#### 1.4. rejeita-part-numbers-invalido

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia `POST /videos/{public_id}/upload/parts` como A com `{ "part_numbers": [] }`
    - expect: status `400`
  2. API-caller envia `POST /videos/{public_id}/upload/parts` como A com `part_numbers` contendo 101 inteiros distintos
    - expect: status `400`

#### 1.5. proibe-usuario-que-nao-e-dono

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia `POST /videos/{public_id}/upload/parts` autenticado como B com `{ "part_numbers": [1] }`
    - expect: status `403`
    - expect: corpo com `error: "VIDEO_ACCESS_DENIED"`

#### 1.6. rejeita-requisicao-anonima

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia `POST /videos/{public_id}/upload/parts` sem o cabeçalho `Authorization` e com `{ "part_numbers": [1] }`
    - expect: status `401`
