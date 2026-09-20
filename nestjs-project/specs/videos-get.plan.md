---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.14
target_file: test/videos-get.e2e-spec.ts
---

# GET /videos/{public_id} — Test Plan

## Application Overview

`GET /videos/{public_id}` é um endpoint público (`@Public()`) que resolve um vídeo pelo identificador de URL única e devolve seus metadados quando ele está `ready`. Vídeo em `draft`, `processing` ou `error` responde `409 VIDEO_NOT_READY`; `public_id` inexistente responde `404 VIDEO_NOT_FOUND`. O `public_id` é estável: é o mesmo devolvido por `POST /videos` e por esta consulta depois do processamento.

## Test Scenarios

### 1. Consultar um vídeo pelo identificador público

**Setup:** `beforeEach` limpa as tabelas com `cleanAllTables`; módulo de teste `Test.createTestingModule({ imports: [AppModule] })` com o `ValidationPipe` e os filtros do `main.ts`; usuário A com canal, cadastrado e confirmado, com `access_token`; o worker não roda neste teste, então os vídeos `ready` são semeados atualizando a linha em `videos` (`status = 'ready'` com `duration_seconds`, `width` e `height`), o que simula o resultado do worker já coberto pelos testes de integração dele.

#### 1.1. anonimo-le-video-pronto

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller cria um vídeo com `POST /videos` como A e semeia a linha como `ready` com `duration_seconds` 12.5, `width` 640 e `height` 360
    - expect: a semeadura atualiza exatamente uma linha em `videos`
  2. API-caller envia `GET /videos/{public_id}` sem o cabeçalho `Authorization`
    - expect: status `200`
    - expect: corpo com `public_id`, `title`, `status: "ready"`, `duration_seconds`, `width`, `height` e `created_at`

#### 1.2. rejeita-video-nao-pronto

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller cria vídeos com `POST /videos` como A e deixa um em `draft`, outro em `processing` e outro em `error` (atualizando a linha)
    - expect: três `public_id` distintos
  2. API-caller envia `GET /videos/{public_id}` sem `Authorization` para cada um dos três
    - expect: status `409` em todos
    - expect: corpo com `error: "VIDEO_NOT_READY"` em todos

#### 1.3. video-inexistente

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia `GET /videos/aaaaaaaaaaa` sem `Authorization` (um `public_id` de 11 caracteres que não existe)
    - expect: status `404`
    - expect: corpo com `error: "VIDEO_NOT_FOUND"`

#### 1.4. public-id-e-estavel-apos-o-processamento

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller cria um vídeo com `POST /videos` como A e guarda o `public_id` devolvido
    - expect: o `public_id` tem 11 caracteres
  2. API-caller semeia a linha do vídeo como `ready` e envia `GET /videos/{public_id}` com o mesmo `public_id`
    - expect: status `200`
    - expect: o `public_id` no corpo é igual ao devolvido por `POST /videos`
