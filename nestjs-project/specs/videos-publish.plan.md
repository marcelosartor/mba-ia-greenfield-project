---
subproject: backend
runner: jest+supertest
scope: phase-04-gerenciamento
si: SI-04.11
target_file: test/videos-publish.e2e-spec.ts
---

# POST /videos/{public_id}/publication — Test Plan

## Application Overview

`POST /videos/{public_id}/publication` é uma rota autenticada, só do dono, que publica um vídeo `ready`. O corpo aceita `visibility` opcional (`public` por padrão ou `unlisted`). Cada chamada grava `published_at = now()`, inclusive num vídeo já publicado (idempotente no efeito). Vídeo que não está `ready` responde `409 VIDEO_NOT_PUBLISHABLE`; `visibility` inválida ou campo desconhecido, `400 VALIDATION_ERROR`; outro usuário, `403 VIDEO_ACCESS_DENIED`; sem token, `401`. A resposta é o `VideoResponse`. Throttler `authenticated`.

## Test Scenarios

### 1. Publicar um vídeo

**Setup:** `beforeEach` limpa as tabelas com `cleanAllTables` e o storage do throttler; app criado por `createE2eApp`; usuários A (dono) e B logados por `registerConfirmAndLogin`; vídeos criados por `POST /videos` como A e semeados como `ready` ou `processing` atualizando a linha (o worker não roda neste teste).

#### 1.1. publica-publico-por-padrao

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller semeia um vídeo de A como `ready` em rascunho e envia `POST /videos/{public_id}/publication` com o token de A, sem corpo
    - expect: status `200` com `visibility: "public"` e `published_at` preenchido
  2. API-caller envia `GET /videos/{public_id}` sem `Authorization`
    - expect: status `200`

#### 1.2. publica-como-nao-listado

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `POST /videos/{public_id}/publication` como A com `{ "visibility": "unlisted" }` num vídeo `ready`
    - expect: status `200` com `visibility: "unlisted"` e `published_at` preenchido

#### 1.3. republicar-renova-published-at

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller publica um vídeo `ready` de A e guarda o `published_at` da resposta
    - expect: status `200`
  2. API-caller aguarda pelo menos 1 segundo e envia de novo `POST /videos/{public_id}/publication` como A
    - expect: status `200` com `published_at` posterior ao guardado

#### 1.4. nao-publica-video-em-processamento

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller semeia um vídeo de A como `processing` e envia `POST /videos/{public_id}/publication` como A
    - expect: status `409` com `error: "VIDEO_NOT_PUBLISHABLE"`
    - expect: a linha continua com `published_at` nulo

#### 1.5. visibilidade-invalida

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `POST /videos/{public_id}/publication` como A com `{ "visibility": "private" }` num vídeo `ready`
    - expect: status `400` com `error: "VALIDATION_ERROR"` e a linha continua sem `published_at`

#### 1.6. autorizacao

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `POST /videos/{public_id}/publication` com o token de B num vídeo `ready` de A
    - expect: status `403` com `error: "VIDEO_ACCESS_DENIED"` e a linha continua sem `published_at`
  2. API-caller envia a mesma requisição sem `Authorization`
    - expect: status `401`
