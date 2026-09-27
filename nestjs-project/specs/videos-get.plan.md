---
subproject: backend
runner: jest+supertest
scope: phase-04-gerenciamento
si: SI-04.7
target_file: test/videos-get.e2e-spec.ts
---

# GET /videos/{public_id} — Test Plan

## Application Overview

`GET /videos/{public_id}` é uma rota de autenticação opcional (`@OptionalAuth()`) que devolve os metadados de um vídeo pelo identificador público. Vídeo publicado é lido por qualquer um; vídeo em rascunho (`published_at` nulo) só pelo dono do canal — para os demais, inclusive anônimos, responde `404 VIDEO_NOT_FOUND`; depois dessa checagem, vídeo que não está `ready` responde `409 VIDEO_NOT_READY` (na prática só o dono chega lá). Token ausente, inválido ou expirado é tratado como anônimo. A resposta é o `VideoResponse` ampliado da Fase 04 e vem com `Cache-Control: private, no-cache`. Reescrito na Fase 04 a partir do spec da SI-03.14.

## Test Scenarios

### 1. Ler os metadados de um vídeo conforme a publicação

**Setup:** `beforeEach` limpa as tabelas com `cleanAllTables` e o storage do throttler; app criado por `createE2eApp` (`test/helpers/e2e-app.ts`), que reproduz o `ValidationPipe` e os filtros do `main.ts`; usuários A (dono, com canal) e B (outro usuário) cadastrados, confirmados e logados por `registerConfirmAndLogin`; o worker não roda neste teste, então os estados são semeados atualizando a linha em `videos` depois de `POST /videos` como A (`status`, `duration_seconds`, `width`, `height`, `published_at`, `visibility`, `category_id`), o que simula o resultado do worker e da publicação já cobertos nos testes de integração.

#### 1.1. anonimo-le-video-publicado-com-contrato-ampliado

**Covers AC:** #1, #5
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller cria um vídeo como A e semeia a linha como `ready`, publicada (`published_at = now()`, `visibility = 'public'`), com `description` "Sobre o vídeo" e a categoria `musica`
    - expect: a semeadura atualiza exatamente uma linha em `videos`
  2. API-caller envia `GET /videos/{public_id}` sem o cabeçalho `Authorization`
    - expect: status `200` e cabeçalho `Cache-Control: private, no-cache`
    - expect: corpo com `description: "Sobre o vídeo"`, `category: { "slug": "musica", "name": "Música" }`, `visibility: "public"`, `published_at` preenchido, `thumbnail_url` igual a `/videos/{public_id}/thumbnail` e `updated_at`
    - expect: o corpo não tem `id`, `channel_id`, `video_key`, `thumbnail_key` nem `custom_thumbnail_key`

#### 1.2. rascunho-pronto-so-para-o-dono

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller cria um vídeo como A e semeia a linha como `ready` com `published_at` nulo
    - expect: a linha fica `ready` sem `published_at`
  2. API-caller envia `GET /videos/{public_id}` sem `Authorization` e depois com o token de B
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"` nas duas chamadas
  3. API-caller envia `GET /videos/{public_id}` com o token de A
    - expect: status `200` com `published_at: null`

#### 1.3. video-em-processamento-404-antes-de-409

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller cria um vídeo como A e semeia a linha como `processing`
    - expect: a linha fica `processing` sem `published_at`
  2. API-caller envia `GET /videos/{public_id}` sem `Authorization`
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`
  3. API-caller envia `GET /videos/{public_id}` com o token de A
    - expect: status `409` com `error: "VIDEO_NOT_READY"`

#### 1.4. token-expirado-vale-como-anonimo

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller semeia um vídeo de A como `ready` e publicado e assina, com o `JwtService` da aplicação, um token de A com `exp` no passado
    - expect: o token está expirado
  2. API-caller envia `GET /videos/{public_id}` com `Authorization: Bearer {token expirado}`
    - expect: status `200`, sem `401`
  3. API-caller semeia outro vídeo de A como `ready` em rascunho e envia `GET /videos/{public_id}` com o mesmo token expirado
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"` (o token expirado não identifica o dono)

#### 1.5. video-inexistente

**Source:** manual
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `GET /videos/aaaaaaaaaaa` com o token de A (um `public_id` de 11 caracteres que não existe; regressão da SI-03.14)
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`
