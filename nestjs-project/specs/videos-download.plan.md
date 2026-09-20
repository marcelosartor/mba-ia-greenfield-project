---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.16
target_file: test/videos-download.e2e-spec.ts
---

# GET /videos/{public_id}/download — Test Plan

## Application Overview

`GET /videos/{public_id}/download` é um endpoint público (`@Public()`) que entrega o arquivo completo do vídeo `ready` como anexo, reaproveitando a leitura em stream do storage. A resposta traz `Content-Disposition: attachment` com o nome montado a partir do título saneado e da extensão da `video_key`. Vídeo que não está `ready` responde `409` e `public_id` inexistente `404`.

## Test Scenarios

### 1. Baixar o arquivo do vídeo

**Setup:** `beforeEach` limpa as tabelas com `cleanAllTables` e o bucket `videos` do MinIO real; módulo de teste `Test.createTestingModule({ imports: [AppModule] })` com o `ValidationPipe` e os filtros do `main.ts`; usuário A com canal; um vídeo `ready` semeado com um objeto real de 2097152 bytes (SHA-256 conhecido) na `video_key` `{channelId}/{videoId}/source.mp4` e `title` `Meu vídeo: teste/1` (o worker não roda neste teste).

#### 1.1. baixa-arquivo-integro

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia `GET /videos/{public_id}/download` sem o cabeçalho `Authorization`
    - expect: status `200`
    - expect: `Content-Length` igual a `2097152`
    - expect: o SHA-256 do corpo é igual ao do arquivo original

#### 1.2. define-nome-de-arquivo-do-anexo

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia `GET /videos/{public_id}/download` sem `Authorization` para o vídeo de título `Meu vídeo: teste/1`
    - expect: o cabeçalho `Content-Disposition` começa com `attachment; filename="`
    - expect: o nome termina em `.mp4` e não contém `/` nem `:` (caracteres inseguros saneados)
    - expect: o cabeçalho traz também `filename*` com o nome codificado para os caracteres não ASCII

#### 1.3. rejeita-video-nao-pronto

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia `GET /videos/{public_id}/download` para vídeos em `draft`, `processing` e `error`
    - expect: status `409` em todos
    - expect: corpo com `error: "VIDEO_NOT_READY"` em todos

#### 1.4. video-inexistente

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia `GET /videos/aaaaaaaaaaa/download` (um `public_id` de 11 caracteres que não existe)
    - expect: status `404`
    - expect: corpo com `error: "VIDEO_NOT_FOUND"`
