---
subproject: backend
runner: jest+supertest
scope: phase-04-gerenciamento
si: SI-04.9
target_file: test/videos-download.e2e-spec.ts
---

# GET /videos/{public_id}/download — Test Plan

## Application Overview

`GET /videos/{public_id}/download` é uma rota de autenticação opcional (`@OptionalAuth()`) que entrega o arquivo completo como anexo, em stream do storage, seguindo a regra de acesso da Fase 04: vídeo publicado para todos, rascunho só para o dono (`404 VIDEO_NOT_FOUND` para os demais), e `409 VIDEO_NOT_READY` depois disso. A resposta traz `Content-Disposition: attachment` com o nome montado a partir do título saneado e `Cache-Control: private, no-cache`. Reescrito na Fase 04 a partir do spec da SI-03.16; os cenários de comportamento da Fase 03 que continuam valendo ficam como regressão (`Source: manual`).

## Test Scenarios

### 1. Baixar o arquivo conforme a publicação

**Setup:** `beforeEach` limpa as tabelas com `cleanAllTables`, o bucket `videos` do MinIO real e o storage do throttler; app criado por `createE2eApp`; usuários A (dono) e B logados por `registerConfirmAndLogin`; um vídeo de A semeado como `ready` com um objeto real de 2097152 bytes (SHA-256 conhecido) na `video_key` `{channelId}/{videoId}/source.mp4` e `title` `Meu vídeo: teste/1`; os cenários publicam ou deixam em rascunho atualizando a linha (o worker não roda neste teste).

#### 1.1. baixa-video-publicado-com-cache-privado

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller publica o vídeo semeado e envia `GET /videos/{public_id}/download` sem `Authorization`
    - expect: status `200`
    - expect: `Content-Disposition` começando com `attachment; filename="` e `Cache-Control: private, no-cache`
    - expect: `Content-Length` igual a `2097152` e o SHA-256 do corpo igual ao do arquivo original

#### 1.2. rascunho-so-para-o-dono

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller deixa o vídeo semeado em rascunho e envia `GET /videos/{public_id}/download` com o token de B
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`
  2. API-caller envia `GET /videos/{public_id}/download` com o token de A
    - expect: status `200` com o arquivo inteiro

#### 1.3. video-em-erro-para-o-dono

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller semeia um vídeo de A como `error` e envia `GET /videos/{public_id}/download` com o token de A
    - expect: status `409` com `error: "VIDEO_NOT_READY"`
  2. API-caller envia a mesma requisição sem `Authorization`
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`

#### 1.4. define-nome-de-arquivo-do-anexo

**Source:** manual
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller publica o vídeo de título `Meu vídeo: teste/1` e envia `GET /videos/{public_id}/download` sem `Authorization` (regressão da SI-03.16)
    - expect: o nome em `Content-Disposition` termina em `.mp4` e não contém `/` nem `:`
    - expect: o cabeçalho traz também `filename*` com o nome codificado para os caracteres não ASCII

#### 1.5. video-inexistente

**Source:** manual
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `GET /videos/aaaaaaaaaaa/download` (um `public_id` de 11 caracteres que não existe)
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`
