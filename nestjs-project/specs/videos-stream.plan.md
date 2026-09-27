---
subproject: backend
runner: jest+supertest
scope: phase-04-gerenciamento
si: SI-04.8
target_file: test/videos-stream.e2e-spec.ts
---

# GET /videos/{public_id}/stream — Test Plan

## Application Overview

`GET /videos/{public_id}/stream` é uma rota de autenticação opcional (`@OptionalAuth()`) que entrega o vídeo por streaming com requisições parciais, seguindo a regra de acesso da Fase 04: vídeo publicado para todos, rascunho só para o dono (`404 VIDEO_NOT_FOUND` para os demais), e `409 VIDEO_NOT_READY` depois disso. Com `Range` de um único intervalo responde `206` com `Content-Range`; sem `Range`, `200` transmitindo o objeto do storage sem carregá-lo inteiro na memória; intervalo não satisfatório, `416 INVALID_RANGE`. As respostas de sucesso trazem `Cache-Control: private, no-cache`. Reescrito na Fase 04 a partir do spec da SI-03.15; os cenários de comportamento da Fase 03 que continuam valendo ficam como regressão (`Source: manual`).

## Test Scenarios

### 1. Transmitir o vídeo conforme a publicação

**Setup:** `beforeEach` limpa as tabelas com `cleanAllTables`, o bucket `videos` do MinIO real e o storage do throttler; app criado por `createE2eApp`; usuários A (dono) e B logados por `registerConfirmAndLogin`; um vídeo de A semeado como `ready` com um objeto real de 3145728 bytes (conteúdo pseudoaleatório com SHA-256 conhecido) na `video_key` da linha; os cenários publicam (`published_at = now()`, `visibility = 'public'`) ou deixam em rascunho atualizando a linha (o worker não roda neste teste).

#### 1.1. primeiro-quilobyte-por-range-em-video-publicado

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller publica o vídeo semeado e envia `GET /videos/{public_id}/stream` sem `Authorization` e com `Range: bytes=0-1023`
    - expect: status `206`
    - expect: `Content-Range` igual a `bytes 0-1023/3145728`, `Content-Length` igual a `1024` e `Cache-Control: private, no-cache`
    - expect: o corpo tem exatamente 1024 bytes, iguais aos 1024 primeiros do objeto original

#### 1.2. rascunho-so-para-o-dono

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller deixa o vídeo semeado em rascunho e envia `GET /videos/{public_id}/stream` sem `Authorization`
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`
  2. API-caller envia `GET /videos/{public_id}/stream` com o token de B
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`
  3. API-caller envia `GET /videos/{public_id}/stream` com o token de A e sem `Range`
    - expect: status `200` e o SHA-256 do corpo igual ao do objeto original

#### 1.3. range-nao-satisfatorio

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller publica o vídeo semeado e envia `GET /videos/{public_id}/stream` com `Range: bytes=9999999-10000000`
    - expect: status `416` com `error: "INVALID_RANGE"`
    - expect: `Content-Range` igual a `bytes */3145728`

#### 1.4. stream-completo-sem-range

**Source:** manual
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller publica o vídeo semeado e envia `GET /videos/{public_id}/stream` sem `Authorization` e sem `Range` (regressão da SI-03.15)
    - expect: status `200`
    - expect: `Accept-Ranges: bytes` e `Content-Length` igual a `3145728`
    - expect: o SHA-256 do corpo é igual ao do arquivo original

#### 1.5. nao-pronto-e-inexistente

**Source:** manual
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller semeia vídeos de A em `draft`, `processing` e `error` e envia `GET /videos/{public_id}/stream` com o token de A para cada um (regressão da SI-03.15 sob a regra do dono)
    - expect: status `409` em todos, com `error: "VIDEO_NOT_READY"`
  2. API-caller envia `GET /videos/aaaaaaaaaaa/stream` (um `public_id` de 11 caracteres que não existe)
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`

#### 1.6. stream-nao-bufferiza-o-arquivo

**Source:** manual
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller semeia um vídeo `ready` e publicado com um objeto de 209715200 bytes (200 MiB) no bucket `videos` e registra `process.memoryUsage().heapUsed` antes da requisição (regressão da SI-03.15)
    - expect: o objeto existe no storage com o tamanho esperado
  2. API-caller envia `GET /videos/{public_id}/stream` sem `Range` e consome o corpo em stream, calculando o SHA-256 sem acumular os bytes
    - expect: status `200` e o SHA-256 igual ao do objeto original
    - expect: o aumento de `heapUsed` entre o início e o fim da requisição é inferior a 52428800 bytes (50 MiB)

#### 1.7. busca-em-qualquer-ponto-do-arquivo

**Source:** manual
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `GET /videos/{public_id}/stream` de um vídeo publicado com `Range: bytes=3144728-` (os últimos 1000 bytes; regressão da SI-03.15)
    - expect: status `206` com `Content-Range` igual a `bytes 3144728-3145727/3145728`
    - expect: o SHA-256 do corpo é igual ao dos últimos 1000 bytes do objeto

#### 1.8. ignora-range-com-mais-de-um-intervalo

**Source:** manual
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `GET /videos/{public_id}/stream` de um vídeo publicado com `Range: bytes=0-10,20-30` (regressão da SI-03.15)
    - expect: status `200` com `Content-Length` igual a `3145728`

#### 1.9. para-de-ler-o-storage-quando-o-cliente-sai

**Source:** manual
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller abre `GET /videos/{public_id}/stream` de um vídeo publicado de 40 MiB e fecha a conexão ao receber o primeiro bloco (regressão da SI-03.15)
    - expect: o stream de leitura do storage é destruído em até 10 segundos
