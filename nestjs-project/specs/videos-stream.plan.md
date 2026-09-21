---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.15
target_file: test/videos-stream.e2e-spec.ts
---

# GET /videos/{public_id}/stream — Test Plan

## Application Overview

`GET /videos/{public_id}/stream` é um endpoint público (`@Public()`) que entrega o vídeo `ready` por streaming com requisições parciais. Com `Range` de um único intervalo responde `206` com `Content-Range` e apenas o trecho pedido; sem `Range` responde `200` transmitindo o objeto do storage sem carregá-lo inteiro na memória da API; intervalo não satisfatório responde `416 INVALID_RANGE` com `Content-Range: bytes */{total}`. Vídeo que não está `ready` responde `409` e `public_id` inexistente `404`.

## Test Scenarios

### 1. Transmitir o vídeo por streaming

**Setup:** `beforeEach` limpa as tabelas com `cleanAllTables` e o bucket `videos` do MinIO real; módulo de teste `Test.createTestingModule({ imports: [AppModule] })` com o `ValidationPipe` e os filtros do `main.ts`; usuário A com canal; um vídeo `ready` semeado com um objeto real de 3145728 bytes (conteúdo pseudoaleatório com hash SHA-256 conhecido) enviado ao bucket `videos` na `video_key` da linha (o worker não roda neste teste).

#### 1.1. primeiro-quilobyte-por-range

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia `GET /videos/{public_id}/stream` sem `Authorization` e com `Range: bytes=0-1023`
    - expect: status `206`
    - expect: `Content-Range` igual a `bytes 0-1023/3145728` e `Content-Length` igual a `1024`
    - expect: o corpo tem exatamente 1024 bytes, iguais aos 1024 primeiros do objeto original

#### 1.2. stream-completo-sem-range

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia `GET /videos/{public_id}/stream` sem `Authorization` e sem `Range`
    - expect: status `200`
    - expect: `Accept-Ranges: bytes` e `Content-Length` igual a `3145728`
    - expect: o SHA-256 do corpo é igual ao do arquivo original

#### 1.3. range-nao-satisfatorio

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia `GET /videos/{public_id}/stream` com `Range: bytes=9999999-10000000`
    - expect: status `416`
    - expect: corpo com `error: "INVALID_RANGE"`
    - expect: `Content-Range` igual a `bytes */3145728`

#### 1.4. rejeita-video-nao-pronto-e-inexistente

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia `GET /videos/{public_id}/stream` para vídeos em `draft`, `processing` e `error`
    - expect: status `409` em todos, com `error: "VIDEO_NOT_READY"`
  2. API-caller envia `GET /videos/aaaaaaaaaaa/stream` (um `public_id` de 11 caracteres que não existe)
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`

#### 1.5. stream-nao-bufferiza-o-arquivo

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller semeia um vídeo `ready` com um objeto de 209715200 bytes (200 MiB) no bucket `videos` e registra `process.memoryUsage().heapUsed` antes da requisição
    - expect: o objeto existe no storage com o tamanho esperado
  2. API-caller envia `GET /videos/{public_id}/stream` sem `Range` e consome o corpo em stream, calculando o SHA-256 sem acumular os bytes
    - expect: status `200` e o SHA-256 igual ao do objeto original
    - expect: o aumento de `heapUsed` entre o início e o fim da requisição é inferior a 52428800 bytes (50 MiB)
