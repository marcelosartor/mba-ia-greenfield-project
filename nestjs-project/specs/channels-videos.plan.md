---
subproject: backend
runner: jest+supertest
scope: phase-04-gerenciamento
si: SI-04.22
target_file: test/channels-videos.e2e-spec.ts
---

# GET /channels/{nickname}/videos — Test Plan

## Application Overview

`GET /channels/{nickname}/videos` é uma rota pública (`@Public()`) que lista os vídeos listáveis de um canal — publicados e com `visibility = 'public'` —, paginados (`page` ≥ 1 padrão 1, `limit` 1–50 padrão 20) e ordenados por `published_at DESC, id DESC`. Cada item traz `public_id`, `title`, `thumbnail_url`, `duration_seconds` e `published_at`. Vídeos `unlisted` e em rascunho nunca aparecem (o `unlisted` segue acessível pelo link). Canal inexistente responde `404 CHANNEL_NOT_FOUND`; paginação inválida, `400 VALIDATION_ERROR`. Usa o throttler `public-read`.

## Test Scenarios

### 1. Listar os vídeos públicos do canal

**Setup:** `beforeEach` limpa as tabelas com `cleanAllTables` e o storage do throttler; app criado por `createE2eApp`; usuário A logado por `registerConfirmAndLogin`; vídeos de A criados por `POST /videos` e semeados como `ready` atualizando a linha em `videos`: dois publicados e públicos com `published_at` distintos (um há 2 horas, outro há 1 hora), um publicado `unlisted` e um em rascunho (o worker não roda neste teste).

#### 1.1. anonimo-lista-publicos-por-publicacao

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `GET /channels/{nickname de A}/videos` sem `Authorization`
    - expect: status `200` com 2 itens e `total: 2`
    - expect: o primeiro item é o publicado há 1 hora e o segundo o publicado há 2 horas
    - expect: cada item tem exatamente `public_id`, `title`, `thumbnail_url`, `duration_seconds` e `published_at`

#### 1.2. unlisted-e-rascunho-ficam-de-fora

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller confere a resposta de `GET /channels/{nickname de A}/videos`
    - expect: nenhum item tem o `public_id` do vídeo `unlisted` nem o do rascunho
  2. API-caller envia `GET /videos/{public_id do unlisted}` sem `Authorization`
    - expect: status `200`

#### 1.3. canal-inexistente

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `GET /channels/inexistente/videos`
    - expect: status `404` com `error: "CHANNEL_NOT_FOUND"`

#### 1.4. paginacao-invalida

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `GET /channels/{nickname de A}/videos?limit=0`
    - expect: status `400` com `error: "VALIDATION_ERROR"`

#### 1.5. rota-publica-nao-recebe-429

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia 25 requisições seguidas a `GET /channels/{nickname de A}/videos` sem `Authorization`, do mesmo IP
    - expect: as 25 respostas têm status `200`, nenhuma `429`
