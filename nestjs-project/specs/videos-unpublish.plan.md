---
subproject: backend
runner: jest+supertest
scope: phase-04-gerenciamento
si: SI-04.12
target_file: test/videos-unpublish.e2e-spec.ts
---

# DELETE /videos/{public_id}/publication — Test Plan

## Application Overview

`DELETE /videos/{public_id}/publication` é uma rota autenticada, só do dono, que despublica um vídeo: zera `published_at` e mantém a `visibility`. Responde `204` também quando o vídeo já está em rascunho (idempotente). Depois de despublicar, as leituras (metadados, `stream`, `download`) respondem `404 VIDEO_NOT_FOUND` para quem não é o dono. Outro usuário, `403 VIDEO_ACCESS_DENIED`; sem token, `401`; `public_id` inexistente, `404`. Throttler `authenticated`.

## Test Scenarios

### 1. Despublicar um vídeo

**Setup:** `beforeEach` limpa as tabelas com `cleanAllTables`, o bucket `videos` do MinIO real e o storage do throttler; app criado por `createE2eApp`; usuários A (dono) e B logados por `registerConfirmAndLogin`; um vídeo de A semeado como `ready`, publicado com `visibility = 'unlisted'` e com um objeto real pequeno na `video_key` (para `stream` e `download` responderem).

#### 1.1. despublica-e-bloqueia-leituras

**Covers AC:** #1, #2
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `DELETE /videos/{public_id}/publication` com o token de A
    - expect: status `204` sem corpo
    - expect: a linha tem `published_at` nulo e `visibility = 'unlisted'`
  2. API-caller envia `GET /videos/{public_id}`, `GET /videos/{public_id}/stream` e `GET /videos/{public_id}/download` sem `Authorization`
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"` nas três
  3. API-caller repete as três leituras com o token de A
    - expect: status `200` nas três

#### 1.2. despublicar-rascunho-e-idempotente

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `DELETE /videos/{public_id}/publication` como A duas vezes seguidas
    - expect: status `204` nas duas

#### 1.3. autorizacao-e-inexistente

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `DELETE /videos/{public_id}/publication` com o token de B
    - expect: status `403` com `error: "VIDEO_ACCESS_DENIED"` e o vídeo continua publicado
  2. API-caller envia a mesma requisição sem `Authorization`
    - expect: status `401`
  3. API-caller envia `DELETE /videos/aaaaaaaaaaa/publication` como A
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`
