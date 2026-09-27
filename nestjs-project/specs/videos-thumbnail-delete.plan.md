---
subproject: backend
runner: jest+supertest
scope: phase-04-gerenciamento
si: SI-04.16
target_file: test/videos-thumbnail-delete.e2e-spec.ts
---

# DELETE /videos/{public_id}/thumbnail — Test Plan

## Application Overview

`DELETE /videos/{public_id}/thumbnail` é uma rota autenticada, só do dono, que remove a capa customizada: zera `custom_thumbnail_key` e apaga `thumbnails/{videoId}/custom.jpg`, fazendo o vídeo voltar à capa gerada. Responde `204` também quando não há capa customizada (idempotente). Outro usuário, `403 VIDEO_ACCESS_DENIED`; sem token, `401`. Throttler `uploads`.

## Test Scenarios

### 1. Remover a capa customizada

**Setup:** `beforeEach` limpa as tabelas com `cleanAllTables`, o bucket `thumbnails` do MinIO real e o storage do throttler; app criado por `createE2eApp`; usuários A (dono) e B logados por `registerConfirmAndLogin`; um vídeo de A semeado como `ready` e publicado, com `default.jpg` e `custom.jpg` (JPEGs distintos gerados com o `ffmpeg` do contêiner) gravados no bucket e `thumbnail_key` e `custom_thumbnail_key` preenchidas.

#### 1.1. remove-e-volta-para-a-capa-gerada

**Covers AC:** #1, #2
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `DELETE /videos/{public_id}/thumbnail` com o token de A
    - expect: status `204`
    - expect: a linha tem `custom_thumbnail_key` nula e o objeto `thumbnails/{videoId}/custom.jpg` não existe mais
  2. API-caller envia `GET /videos/{public_id}/thumbnail` sem `Authorization`
    - expect: status `200` com os bytes de `default.jpg`

#### 1.2. sem-capa-customizada-e-idempotente

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `DELETE /videos/{public_id}/thumbnail` como A duas vezes seguidas
    - expect: status `204` nas duas
    - expect: o objeto `default.jpg` continua no bucket

#### 1.3. autorizacao

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `DELETE /videos/{public_id}/thumbnail` com o token de B
    - expect: status `403` com `error: "VIDEO_ACCESS_DENIED"` e `custom.jpg` continua no bucket
  2. API-caller envia a mesma requisição sem `Authorization`
    - expect: status `401`
