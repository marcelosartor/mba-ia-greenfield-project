---
subproject: backend
runner: jest+supertest
scope: phase-04-gerenciamento
si: SI-04.19
target_file: test/channels-update-me.e2e-spec.ts
---

# PATCH /channels/me — Test Plan

## Application Overview

`PATCH /channels/me` é uma rota autenticada que edita parcialmente o canal do usuário do JWT: `nickname` (`^[a-z0-9_]{3,50}$`, fora da lista de reservados), `name` (1–50 após `trim`) e `description` (até 5.000, `null` limpa). A unicidade do nickname é decidida pelo `UNIQUE` do banco. Corpo vazio, campo desconhecido ou formato inválido respondem `400 VALIDATION_ERROR`; nickname reservado, `400 NICKNAME_RESERVED`; nickname de outro canal, `409 NICKNAME_ALREADY_EXISTS`; sem token, `401`. A resposta traz `name`, `nickname`, `description` e `created_at`, nunca `id`, `user_id` ou e-mail. Throttler `authenticated`.

## Test Scenarios

### 1. Editar o próprio canal

**Setup:** `beforeEach` limpa as tabelas com `cleanAllTables` e o storage do throttler; app criado por `createE2eApp`; usuários A e B cadastrados, confirmados e logados por `registerConfirmAndLogin` (cada um com o canal criado no cadastro).

#### 1.1. dono-edita-nickname-nome-e-descricao

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `PATCH /channels/me` com o token de A e `{ "nickname": "novo_nome", "name": "Meu Canal", "description": "Sobre" }`
    - expect: status `200` com `nickname: "novo_nome"`, `name: "Meu Canal"`, `description: "Sobre"` e `created_at`
    - expect: o corpo não tem `id`, `user_id` nem `email`
    - expect: a linha do canal de A em `channels` tem os três valores novos

#### 1.2. nickname-reservado

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `PATCH /channels/me` como A com `{ "nickname": "admin" }`
    - expect: status `400` com `error: "NICKNAME_RESERVED"` e o nickname de A não muda

#### 1.3. nickname-com-formato-invalido

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `PATCH /channels/me` como A com `{ "nickname": "ab" }` e depois com `{ "nickname": "Com-Hifen" }`
    - expect: status `400` com `error: "VALIDATION_ERROR"` nas duas

#### 1.4. nickname-de-outro-canal

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller lê o nickname atual do canal de B e envia `PATCH /channels/me` como A com esse nickname e `{ "name": "Outro" }` no mesmo corpo
    - expect: status `409` com `error: "NICKNAME_ALREADY_EXISTS"`
    - expect: o canal de A mantém o `nickname` e o `name` anteriores

#### 1.5. corpo-vazio-e-campo-proibido

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `PATCH /channels/me` como A com `{}` e depois com `{ "user_id": "00000000-0000-0000-0000-000000000000" }`
    - expect: status `400` com `error: "VALIDATION_ERROR"` nas duas

#### 1.6. anonimo

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-09-27T14:58:10Z

**Steps:**
  1. API-caller envia `PATCH /channels/me` sem `Authorization` e com `{ "name": "X" }`
    - expect: status `401`
