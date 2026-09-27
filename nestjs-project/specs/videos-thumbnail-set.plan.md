---
subproject: backend
runner: jest+supertest
scope: phase-04-gerenciamento
si: SI-04.15
target_file: test/videos-thumbnail-set.e2e-spec.ts
---

# PUT /videos/{public_id}/thumbnail — Test Plan

## Application Overview

`PUT /videos/{public_id}/thumbnail` é uma rota autenticada, só do dono, que recebe uma imagem em `multipart/form-data` (campo `file`, até 2 MiB), valida pelo conteúdo (JPEG, PNG ou WebP), regrava como JPEG de 640 px de largura sem EXIF em `thumbnails/{videoId}/custom.jpg` e preenche `custom_thumbnail_key`. Permitida em qualquer status de processamento; o worker nunca sobrescreve a capa customizada. Arquivo que não é imagem pelo conteúdo, `415 INVALID_IMAGE`; acima de 2 MiB, `413 IMAGE_TOO_LARGE`; sem `file`, `400 VALIDATION_ERROR`; outro usuário, `403`; sem token, `401`. Responde `204`. Throttler `uploads`.

## Test Scenarios

### 1. Enviar uma capa customizada

**Setup:** `beforeEach` limpa as tabelas com `cleanAllTables`, o bucket `thumbnails` do MinIO real e o storage do throttler; app criado por `createE2eApp`; usuários A (dono) e B logados por `registerConfirmAndLogin`; um vídeo de A semeado como `ready` e publicado, com a capa gerada `{videoId}/default.jpg` gravada no bucket; imagens de teste geradas com o `ffmpeg` do contêiner (PNG 800 × 600) e um arquivo de texto de 1 KiB.

#### 1.1. png-valido-vira-capa

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `PUT /videos/{public_id}/thumbnail` com o token de A e o PNG 800 × 600 no campo `file`
    - expect: status `204`
    - expect: a linha tem `custom_thumbnail_key` igual a `{videoId}/custom.jpg`
  2. API-caller envia `GET /videos/{public_id}/thumbnail` com o token de A
    - expect: status `200` com um JPEG de 640 px de largura, diferente dos bytes de `default.jpg`

#### 1.2. texto-disfarcado-de-png

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `PUT /videos/{public_id}/thumbnail` como A com o arquivo de texto no campo `file`, nome `capa.png` e `Content-Type: image/png`
    - expect: status `415` com `error: "INVALID_IMAGE"`
    - expect: `custom_thumbnail_key` continua nula e não existe objeto `custom.jpg` no bucket

#### 1.3. imagem-acima-de-2-mib

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `PUT /videos/{public_id}/thumbnail` como A com um arquivo de 2097153 bytes no campo `file`
    - expect: status `413` com `error: "IMAGE_TOO_LARGE"` e `custom_thumbnail_key` nula

#### 1.4. sem-campo-file

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `PUT /videos/{public_id}/thumbnail` como A em `multipart/form-data` sem o campo `file`
    - expect: status `400` com `error: "VALIDATION_ERROR"`

#### 1.5. autorizacao

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `PUT /videos/{public_id}/thumbnail` com o token de B e o PNG válido
    - expect: status `403` com `error: "VIDEO_ACCESS_DENIED"` e `custom_thumbnail_key` nula
  2. API-caller envia a mesma requisição sem `Authorization`
    - expect: status `401`

#### 1.6. capa-customizada-sobrevive-ao-processamento

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller semeia outro vídeo de A como `processing` e envia `PUT /videos/{public_id}/thumbnail` como A com o PNG válido
    - expect: status `204`
  2. API-caller simula o fim do processamento como o worker faz: atualiza a linha para `ready` com `thumbnail_key` `{videoId}/default.jpg` e grava esse objeto no bucket
    - expect: `custom_thumbnail_key` continua `{videoId}/custom.jpg`
  3. API-caller envia `GET /videos/{public_id}/thumbnail` com o token de A
    - expect: status `200` com os bytes de `custom.jpg`, não os de `default.jpg`
