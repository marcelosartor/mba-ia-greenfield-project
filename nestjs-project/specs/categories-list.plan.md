---
subproject: backend
runner: jest+supertest
scope: phase-04-gerenciamento
si: SI-04.5
target_file: test/categories-list.e2e-spec.ts
---

# GET /categories — Test Plan

## Application Overview

`GET /categories` é uma rota pública (`@Public()`) que lista as categorias de vídeo da plataforma, criadas pela migration de dados da Fase 04, como `{ slug, name }` ordenadas por `name` com `outros` por último. Usa o throttler `public-read` (300 por minuto por IP), nunca o `default` de 10 por minuto.

## Test Scenarios

### 1. Listar as categorias

**Setup:** app criado por `createE2eApp` sobre o banco de teste com as migrations aplicadas (as 11 categorias vêm da migration de dados, sem seed manual); `beforeEach` limpa o storage do throttler; nenhum usuário é necessário.

#### 1.1. lista-inicial-ordenada-sem-autenticacao

**Covers AC:** #1, #2
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `GET /categories` sem o cabeçalho `Authorization`
    - expect: status `200`
    - expect: corpo é um array com 11 itens, cada um com exatamente `slug` e `name`, sem `id`
    - expect: os `slug` são os da lista inicial e o último item tem `slug: "outros"`
    - expect: os 10 primeiros estão em ordem crescente de `name`

#### 1.2. rota-publica-nao-recebe-429

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia 25 requisições seguidas a `GET /categories` sem `Authorization`, do mesmo IP
    - expect: as 25 respostas têm status `200`, nenhuma `429`
