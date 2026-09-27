---
subproject: backend
runner: jest+supertest
scope: phase-04-gerenciamento
si: SI-04.10
target_file: test/videos-update.e2e-spec.ts
---

# PATCH /videos/{public_id} — Test Plan

## Application Overview

`PATCH /videos/{public_id}` é uma rota autenticada, só do dono do canal do vídeo, que edita parcialmente `title` (1–100 caracteres após `trim`), `description` (até 5.000, `null` limpa), `category` (por `slug`, `null` limpa) e `visibility` (`public` | `unlisted`, sem alterar `published_at`). É permitida em qualquer status de processamento. Corpo vazio e campo desconhecido respondem `400 VALIDATION_ERROR`; slug inexistente, `400 INVALID_CATEGORY`; outro usuário, `403 VIDEO_ACCESS_DENIED`; sem token, `401`; `public_id` inexistente, `404 VIDEO_NOT_FOUND`. A resposta é o `VideoResponse` com o `updated_at` atual. Throttler `authenticated`.

## Test Scenarios

### 1. Editar as informações do vídeo

**Setup:** `beforeEach` limpa as tabelas com `cleanAllTables` e o storage do throttler; app criado por `createE2eApp`; usuários A (dono) e B logados por `registerConfirmAndLogin`; um vídeo criado por `POST /videos` como A; as categorias vêm da migration de dados; estados de processamento e publicação são semeados atualizando a linha em `videos`.

#### 1.1. dono-edita-titulo-e-categoria

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller guarda o `updated_at` do vídeo lendo a linha em `videos`
    - expect: há um `updated_at`
  2. API-caller envia `PATCH /videos/{public_id}` com o token de A e `{ "title": "  Novo título  ", "category": "musica" }`
    - expect: status `200`
    - expect: corpo com `title: "Novo título"`, `category: { "slug": "musica", "name": "Música" }` e `updated_at` posterior ao guardado
    - expect: a linha em `videos` tem o `title` e o `category_id` novos, e `status` e `thumbnail_key` inalterados

#### 1.2. null-limpa-descricao-sem-mexer-no-resto

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `PATCH /videos/{public_id}` como A com `{ "description": "Texto" }` e depois com `{ "description": null }`
    - expect: status `200` nas duas chamadas
    - expect: a segunda resposta tem `description: null` e o mesmo `title` da primeira

#### 1.3. corpo-vazio-e-campos-proibidos

**Covers AC:** #3, #4
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `PATCH /videos/{public_id}` como A com `{}`
    - expect: status `400` com `error: "VALIDATION_ERROR"`
  2. API-caller envia, como A, `{ "status": "ready" }`, depois `{ "video_key": "x" }` e depois `{ "channel_id": "00000000-0000-0000-0000-000000000000" }`
    - expect: status `400` com `error: "VALIDATION_ERROR"` nas três
    - expect: a linha em `videos` continua igual à anterior às chamadas

#### 1.4. titulo-fora-das-regras

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `PATCH /videos/{public_id}` como A com `{ "title": "   " }` e depois com um `title` de 101 caracteres
    - expect: status `400` com `error: "VALIDATION_ERROR"` nas duas
  2. API-caller envia como A um `title` de 100 caracteres
    - expect: status `200`

#### 1.5. categoria-inexistente

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `PATCH /videos/{public_id}` como A com `{ "category": "inexistente" }`
    - expect: status `400` com `error: "INVALID_CATEGORY"`
    - expect: o `category_id` da linha não muda

#### 1.6. autorizacao-e-inexistente

**Covers AC:** #7
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `PATCH /videos/{public_id}` com o token de B e `{ "title": "Invasão" }`
    - expect: status `403` com `error: "VIDEO_ACCESS_DENIED"` e o título não muda
  2. API-caller envia a mesma requisição sem `Authorization`
    - expect: status `401`
  3. API-caller envia `PATCH /videos/aaaaaaaaaaa` como A com `{ "title": "X" }`
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`

#### 1.7. visibilidade-nao-altera-publicacao

**Covers AC:** #8
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller semeia o vídeo de A como `ready` e publicado com `visibility = 'public'` e guarda o `published_at`
    - expect: a linha está publicada
  2. API-caller envia `PATCH /videos/{public_id}` como A com `{ "visibility": "unlisted" }`
    - expect: status `200` com `visibility: "unlisted"` e `published_at` igual ao guardado
