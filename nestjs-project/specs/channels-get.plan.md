---
subproject: backend
runner: jest+supertest
scope: phase-04-gerenciamento
si: SI-04.20
target_file: test/channels-get.e2e-spec.ts
---

# GET /channels/{nickname} — Test Plan

## Application Overview

`GET /channels/{nickname}` é uma rota pública (`@Public()`) que devolve as informações públicas de um canal pelo nickname: `name`, `nickname`, `description`, `created_at` e `video_count` (só vídeos publicados e públicos), sem `id`, `user_id` ou e-mail. Aceita qualquer nickname gravado, mesmo legado. Nickname inexistente responde `404 CHANNEL_NOT_FOUND`. A troca de nickname muda o endereço, sem redirecionamento. Usa o throttler `public-read`.

## Test Scenarios

### 1. Ler a página pública do canal

**Setup:** `beforeEach` limpa as tabelas com `cleanAllTables` e o storage do throttler; app criado por `createE2eApp`; usuário A logado por `registerConfirmAndLogin`, com `name` e `description` do canal definidos por `PATCH /channels/me`; vídeos de A criados por `POST /videos` e semeados atualizando a linha em `videos` (o worker não roda neste teste).

#### 1.1. anonimo-le-informacoes-do-canal

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `GET /channels/{nickname de A}` sem `Authorization`
    - expect: status `200` com `name`, `nickname`, `description`, `created_at` e `video_count`
    - expect: o corpo não tem `id`, `user_id` nem `email`

#### 1.2. video-count-so-conta-listaveis

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller semeia três vídeos de A como `ready`: um publicado com `visibility = 'public'`, um publicado com `visibility = 'unlisted'` e um em rascunho
    - expect: três linhas `ready` em `videos`
  2. API-caller envia `GET /channels/{nickname de A}`
    - expect: status `200` com `video_count: 1`

#### 1.3. canal-inexistente

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `GET /channels/inexistente`
    - expect: status `404` com `error: "CHANNEL_NOT_FOUND"`

#### 1.4. troca-de-nickname-muda-o-endereco

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller guarda o nickname de A e envia `PATCH /channels/me` como A com `{ "nickname": "canal_novo" }`
    - expect: status `200`
  2. API-caller envia `GET /channels/{nickname antigo}` e `GET /channels/canal_novo`
    - expect: `404` com `error: "CHANNEL_NOT_FOUND"` no antigo e `200` no novo

#### 1.5. rota-publica-nao-recebe-429

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia 25 requisições seguidas a `GET /channels/{nickname de A}` sem `Authorization`, do mesmo IP
    - expect: as 25 respostas têm status `200`, nenhuma `429`
