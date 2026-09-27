---
subproject: backend
runner: jest+supertest
scope: phase-04-gerenciamento
si: SI-04.21
target_file: test/channels-me-videos.e2e-spec.ts
---

# GET /channels/me/videos — Test Plan

## Application Overview

`GET /channels/me/videos` é uma rota autenticada que devolve o painel de gerenciamento: todos os vídeos do canal do usuário do JWT, em qualquer status, paginados (`page` ≥ 1 padrão 1, `limit` 1–50 padrão 20) e ordenados por `created_at DESC, id DESC`, sem filtros e sem parâmetro de canal. Cada item traz `public_id`, `title`, `thumbnail_url`, `category`, `status`, `visibility`, `published_at`, `created_at` e `views`, `likes` e `comments` fixos em `0`. A resposta traz `page`, `limit`, `total` e `total_pages`. Paginação inválida responde `400 VALIDATION_ERROR`; sem token, `401`. A rota é declarada antes de `/channels/{nickname}…`. Throttler `authenticated`.

## Test Scenarios

### 1. Listar o painel do próprio canal

**Setup:** `beforeEach` limpa as tabelas com `cleanAllTables` e o storage do throttler; app criado por `createE2eApp`; usuários A e B logados por `registerConfirmAndLogin`; quatro vídeos de A criados por `POST /videos` em sequência e semeados como `draft`, `processing`, `ready` (publicado) e `error` atualizando a linha em `videos` (o worker não roda neste teste).

#### 1.1. dono-ve-todos-os-status

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `GET /channels/me/videos` com o token de A
    - expect: status `200` com 4 itens e `total: 4`
    - expect: os `status` dos itens são `draft`, `processing`, `ready` e `error`
    - expect: cada item tem `public_id`, `title`, `thumbnail_url`, `category`, `status`, `visibility`, `published_at`, `created_at` e `views`, `likes` e `comments` iguais a `0`

#### 1.2. outro-usuario-nao-ve-os-videos

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `GET /channels/me/videos` com o token de B
    - expect: status `200` com `items: []` e `total: 0`

#### 1.3. paginacao-na-ordem-de-criacao

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `GET /channels/me/videos?page=2&limit=1` com o token de A
    - expect: status `200` com 1 item, `page: 2`, `limit: 1`, `total: 4` e `total_pages: 4`
    - expect: o item é o terceiro vídeo criado (o segundo mais recente)

#### 1.4. paginacao-invalida

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `GET /channels/me/videos?limit=51` e depois `GET /channels/me/videos?page=0` com o token de A
    - expect: status `400` com `error: "VALIDATION_ERROR"` nas duas

#### 1.5. anonimo

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `GET /channels/me/videos` sem `Authorization`
    - expect: status `401`

#### 1.6. canal-com-nickname-me-nao-confunde-a-rota

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller grava diretamente no banco o nickname `me` no canal de B (nickname legado, fora das regras novas)
    - expect: a linha do canal de B tem `nickname = 'me'`
  2. API-caller envia `GET /channels/me/videos` com o token de A
    - expect: status `200` com os 4 vídeos de A, não os de B
