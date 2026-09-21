---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.9
target_file: test/videos-upload-completion.e2e-spec.ts
---

# POST /videos/{public_id}/upload/completion — Test Plan

## Application Overview

`POST /videos/{public_id}/upload/completion` confirma o término do upload: a API lista as partes no storage, valida a sequência 1..N (partes intermediárias com `part_size_bytes` e soma até 10 GiB), completa o multipart, registra `upload_completed_at` (e zera `upload_id`) num único UPDATE e, só depois do commit, publica o job `process-video` em `video-processing` com `jobId` igual ao id do vídeo. A chamada é idempotente: repetir a confirmação devolve `202` sem completar de novo nem criar outro job. Falha ao publicar no Redis não desfaz a conclusão (o sweeper republica depois).

## Test Scenarios

### 1. Confirmar a conclusão do upload

**Setup:** `beforeEach` limpa as tabelas com `cleanAllTables`, o bucket `videos` do MinIO real e a fila `video-processing` do Redis real (`obliterate`); módulo de teste `Test.createTestingModule({ imports: [AppModule] })` com o `ValidationPipe` e os filtros do `main.ts`; `VIDEO_UPLOAD_PART_SIZE_BYTES=5242880`; usuários A (dono) e B (outro usuário), ambos com canal, cadastrados e confirmados, com seus `access_token`; um vídeo de A criado por `POST /videos` com `size_bytes` de 12000000 (3 partes).

#### 1.1. conclui-upload-e-publica-job

**Covers AC:** #1, #2
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia por `PUT` as três partes (5242880, 5242880 e 1514240 bytes) nas URLs de `POST /videos/{public_id}/upload/parts` como A
    - expect: os três `PUT` são aceitos pelo storage
  2. API-caller envia `POST /videos/{public_id}/upload/completion` como A
    - expect: status `202`
    - expect: corpo com `upload_completed: true` e `status: "draft"`
    - expect: a linha em `videos` tem `upload_completed_at` preenchido e `upload_id` nulo
    - expect: o objeto `video_key` existe no bucket `videos` com 12000000 bytes
    - expect: existe um job em `video-processing` com `jobId` igual ao id do vídeo e payload `{ "videoId": "<uuid do vídeo>" }`

#### 1.2. confirmacao-e-idempotente

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller conclui o upload como no cenário 1.1 e repete `POST /videos/{public_id}/upload/completion` como A
    - expect: a segunda chamada também retorna `202` com o mesmo corpo
    - expect: continua existindo um único job em `video-processing` para o vídeo

#### 1.3. rejeita-parte-intermediaria-ausente

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller envia por `PUT` apenas as partes 1 e 3 e chama `POST /videos/{public_id}/upload/completion` como A
    - expect: status `409`
    - expect: corpo com `error: "UPLOAD_INCOMPLETE"`
    - expect: `upload_completed_at` continua nulo e nenhum job é publicado

#### 1.4. rejeita-soma-acima-de-10-gib

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. O módulo de teste substitui `StorageService.listParts` por uma versão que devolve partes cuja soma de `size_bytes` excede 10737418240 (não é viável enviar 10 GiB num teste), e API-caller chama `POST /videos/{public_id}/upload/completion` como A
    - expect: status `413`
    - expect: corpo com `error: "VIDEO_TOO_LARGE"`
    - expect: o vídeo deixa de existir em `videos` e nenhum job é publicado

#### 1.5. aceita-conclusao-com-fila-indisponivel

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. O módulo de teste substitui `VideoProcessingPublisher.publish` por uma versão que rejeita (Redis indisponível), API-caller envia as partes e chama `POST /videos/{public_id}/upload/completion` como A
    - expect: status `202`
    - expect: a linha em `videos` permanece `draft` com `upload_completed_at` preenchido (o sweeper republicará o job)

#### 1.6. rejeita-nao-dono-e-anonimo

**Covers AC:** #7
**Source:** auto
**Last sync:** 2026-09-20T16:25:10Z

**Steps:**
  1. API-caller chama `POST /videos/{public_id}/upload/completion` autenticado como B
    - expect: status `403`
    - expect: corpo com `error: "VIDEO_ACCESS_DENIED"`
  2. API-caller chama `POST /videos/{public_id}/upload/completion` sem o cabeçalho `Authorization`
    - expect: status `401`
