---
subproject: backend
runner: jest+supertest
scope: phase-04-gerenciamento
si: SI-04.14
target_file: test/videos-thumbnail-get.e2e-spec.ts
---

# GET /videos/{public_id}/thumbnail — Test Plan

## Application Overview

`GET /videos/{public_id}/thumbnail` é uma rota de autenticação opcional (`@OptionalAuth()`) que serve a capa do vídeo em stream do bucket `thumbnails`: a customizada (`custom_thumbnail_key`) se existir, senão a gerada pelo worker (`thumbnail_key`). Segue a regra de acesso das leituras de vídeo (rascunho só para o dono, `404` antes de `409`) e responde com `Content-Type: image/jpeg` e `Cache-Control: private, no-cache`. Usa o throttler `public-read`.

## Test Scenarios

### 1. Obter a capa do vídeo

**Setup:** `beforeEach` limpa as tabelas com `cleanAllTables`, o bucket `thumbnails` do MinIO real e o storage do throttler; app criado por `createE2eApp`; usuários A (dono) e B logados por `registerConfirmAndLogin`; um vídeo de A semeado como `ready` com `thumbnail_key` `{videoId}/default.jpg` e um JPEG real (gerado com o `ffmpeg` do contêiner) gravado nessa chave, como o worker faria; os cenários publicam ou deixam em rascunho atualizando a linha.

#### 1.1. anonimo-recebe-capa-gerada

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller publica o vídeo semeado e envia `GET /videos/{public_id}/thumbnail` sem `Authorization`
    - expect: status `200`
    - expect: `Content-Type: image/jpeg` e `Cache-Control: private, no-cache`
    - expect: o corpo é byte a byte igual ao objeto `thumbnails/{videoId}/default.jpg`

#### 1.2. rascunho-so-para-o-dono

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller deixa o vídeo em rascunho e envia `GET /videos/{public_id}/thumbnail` sem `Authorization`
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`
  2. API-caller envia a mesma requisição com o token de A
    - expect: status `200` com `Content-Type: image/jpeg`

#### 1.3. video-em-processamento-para-o-dono

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller semeia outro vídeo de A como `processing`, sem `thumbnail_key`, e envia `GET /videos/{public_id}/thumbnail` com o token de A
    - expect: status `409` com `error: "VIDEO_NOT_READY"`

#### 1.4. rota-publica-nao-recebe-429

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller publica o vídeo semeado e envia 25 requisições seguidas a `GET /videos/{public_id}/thumbnail` sem `Authorization`, do mesmo IP
    - expect: as 25 respostas têm status `200`, nenhuma `429`
