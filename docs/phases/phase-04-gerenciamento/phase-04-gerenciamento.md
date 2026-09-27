---
kind: phase
name: phase-04-gerenciamento
test_specs_aware: true
sources_mtime:
  docs/phases/phase-04-gerenciamento/context.md: "2026-09-27T10:53:54-03:00"
  docs/decisions/technical-decisions-phase-04-gerenciamento.md: "2026-09-27T10:52:41-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-09-19T21:07:21-03:00"
---

# Phase 04 — Gerenciamento de Vídeos e Canal

## Objective

Entregar a API de gerenciamento de vídeos e do canal: categorias de vídeo disponíveis na plataforma, edição das informações do vídeo (título, descrição, categoria e thumbnail customizada), visibilidade pública ou unlisted, fluxo de rascunho → publicação com bloqueio de leitura dos não publicados, o painel de gerenciamento de vídeos do canal (com edição a partir do painel), a edição das informações do canal (nickname, nome e descrição) e a página pública do canal com a listagem de vídeos. O Painel e a Página pública são entregues como API (`non-ui`, a UI não faz parte da especificação do projeto).

---

## Step Implementations

### SI-04.1 — Configurar os namespaces e as variáveis de ambiente de limite de requisições e da capa customizada

**Description:** Cria as chaves de configuração que as SIs seguintes leem: o limite do throttler `public-read` e os limites de decodificação da capa customizada, validadas por Joi e com padrão definido.

**Technical actions:**

1. Criar `src/config/throttle.config.ts` com `registerAs('throttle', …)` expondo `publicReadLimit` (per `phase-04-gerenciamento/TD-11`, `phase-01-configuracao-base/TD-03`)
2. Estender `src/config/video.config.ts` com `thumbnailMaxPixels` e `thumbnailDecodeTimeoutMs` (per `phase-04-gerenciamento/TD-07`)
3. Estender `envValidationSchema` em `src/config/env.validation.ts` com `THROTTLE_PUBLIC_READ_LIMIT` (inteiro ≥ 1, padrão 300), `VIDEO_THUMBNAIL_MAX_PIXELS` (inteiro ≥ 1, padrão 16777216, ~16 megapixels) e `VIDEO_THUMBNAIL_TIMEOUT_MS` (inteiro ≥ 1, padrão 5000; valor escolhido por este plano para "alguns segundos") (per `phase-04-gerenciamento/TD-11`, `phase-04-gerenciamento/TD-07`, `phase-01-configuracao-base/TD-02`)
4. Registrar `throttleConfig` no `appConfigModule` (`src/config/app-config.module.ts`) e documentar as três chaves em `.env.example`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `envValidationSchema` | Integration: padrões das três chaves e rejeição de valor não inteiro ou menor que 1 | `src/config/env.validation.integration-spec.ts` |
| `throttleConfig` | Unit: leitura do ambiente e valor padrão | `src/config/throttle.config.spec.ts` |
| `videoConfig` | Unit: `thumbnailMaxPixels` e `thumbnailDecodeTimeoutMs` lidos do ambiente e com padrão | `src/config/video.config.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Sem `THROTTLE_PUBLIC_READ_LIMIT`, `VIDEO_THUMBNAIL_MAX_PIXELS` e `VIDEO_THUMBNAIL_TIMEOUT_MS` definidos, os valores efetivos são 300, 16777216 e 5000
- Iniciar a API com `THROTTLE_PUBLIC_READ_LIMIT=0` falha na validação de ambiente com mensagem que cita a chave
- `.env.example` lista as três chaves novas

---

### SI-04.2 — Implementar a autenticação opcional (`@OptionalAuth()`) no guard global

**Description:** Permite que uma rota seja lida por anônimos e, quando vier um token válido, saiba quem é o usuário — a base da regra "rascunho só para o dono" das leituras de vídeo.

**Technical actions:**

1. Criar `src/auth/decorators/optional-auth.decorator.ts` com `OptionalAuth()` (metadado `IS_OPTIONAL_AUTH_KEY`) e `src/auth/decorators/optional-current-user.decorator.ts` com `OptionalCurrentUser()`, que devolve `JwtPayload | undefined` (per `phase-04-gerenciamento/TD-02`)
2. Alterar `JwtAuthGuard` (`src/auth/guards/jwt-auth.guard.ts`): em rota `@OptionalAuth()`, token válido no cabeçalho `Authorization` preenche `request.user`; token ausente, malformado, inválido ou expirado segue como anônimo, sem lançar; nenhuma outra origem de token (query string, cookie) é lida (per `phase-04-gerenciamento/TD-02`, `phase-02-auth/TD-02`)
3. Criar `src/common/openapi/api-optional-bearer-auth.decorator.ts` com `ApiOptionalBearerAuth()`, que declara a segurança opcional da operação no OpenAPI (`security: [{}, { "access-token": [] }]`); conferir a API do `@nestjs/swagger` instalado pelo context7 antes de implementar (per `phase-04-gerenciamento/TD-02`, `openapi-docs-nestjs/TD-01`)
4. Acrescentar em `.claude/rules/nestjs-controllers.md` a exceção: rota `@OptionalAuth()` usa `ApiOptionalBearerAuth()` (nunca `@ApiBearerAuth` sozinho, nunca `@Public()` junto) (per `phase-04-gerenciamento/TD-02`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `JwtAuthGuard` | Unit: rota `@OptionalAuth()` com token válido (preenche `request.user`), ausente, malformado, com assinatura inválida e expirado (anônimo, sem exceção); rota protegida continua lançando `401` | `src/auth/guards/jwt-auth.guard.spec.ts` |
| `ApiOptionalBearerAuth` | Unit: a operação decorada sai no documento com `security` igual a `[{}, { "access-token": [] }]` | `src/common/openapi/api-optional-bearer-auth.decorator.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Numa rota `@OptionalAuth()`, requisição com token válido chega ao handler com o `sub` do usuário, e requisição sem token, com token expirado ou com `Authorization: Bearer abc` chega como anônima, sem `401`
- Numa rota sem `@Public()` nem `@OptionalAuth()`, requisição com token expirado continua retornando `401`
- Um token enviado como `?token=` ou em cookie não identifica o usuário numa rota `@OptionalAuth()`
- `.claude/rules/nestjs-controllers.md` descreve a exceção de segurança opcional para `@OptionalAuth()`

---

### SI-04.3 — Substituir o throttler único por throttlers nomeados por classe de rota

**Description:** Troca o limite global de 10 requisições por minuto por IP por quatro throttlers nomeados, cada um valendo só na sua classe de rota, para que as rotas públicas novas e o painel não recebam `429` sem afrouxar a autenticação.

**Technical actions:**

1. Criar `src/throttling/throttling.module.ts` com `ThrottlerModule.forRootAsync` registrando `default` (10/min por IP), `public-read` (`throttleConfig.publicReadLimit`/min por IP), `authenticated` (120/min por usuário) e `uploads` (20/min por usuário); `authenticated` e `uploads` usam como chave o `sub` de `request.user` (o `JwtAuthGuard` roda antes do `ThrottlerGuard`) e cada throttler só conta nas rotas da sua classe (`skipIf` por throttler ou `@SkipThrottle` por nome — conferir a API do `@nestjs/throttler` 6.x pelo context7 antes de implementar) (per `phase-04-gerenciamento/TD-11`, Revision de `phase-02-auth/TD-08`)
2. Criar `src/throttling/throttle-class.decorator.ts` com `PublicReadThrottle()`, `AuthenticatedThrottle()` e `UploadsThrottle()`; rota sem marcador cai no `default` (falha fechada para rota esquecida) (per `phase-04-gerenciamento/TD-11`)
3. Mover o `ThrottlerModule.forRoot` de `AuthModule` para o `ThrottlingModule` (importado por `AuthModule`), mantendo os dois `APP_GUARD` em `AuthModule` na ordem `JwtAuthGuard` → `ThrottlerGuard`
4. Marcar as rotas existentes: `POST /videos`, `GET /videos/{public_id}/upload`, `POST …/upload/parts` e `POST …/upload/completion` com `UploadsThrottle()`; `POST /auth/logout` e `GET /auth/me` com `AuthenticatedThrottle()`; as rotas `@Public()` de autenticação ficam no `default`; `GET /` e as leituras de vídeo mantêm `@SkipThrottle()` (per `### Authorization Matrix`)
5. Atualizar `.claude/rules/auth-jwt.md` e a seção de throttler de `.claude/rules/nestjs-testing.md` (limpeza do storage dos quatro throttlers nos e2e) com os throttlers nomeados

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `ThrottlingModule` | Unit: compilação da injeção de dependência com os quatro throttlers | `src/throttling/throttling.module.spec.ts` |
| Tracker por usuário e `skipIf` por classe | Unit: chave pelo `sub` em `authenticated`/`uploads`, por IP em `default`/`public-read`, e cada throttler ignorado fora da sua classe | `src/throttling/throttling.options.spec.ts` |
| Throttlers nomeados na aplicação | E2E: 121ª chamada por minuto de um usuário a `GET /auth/me` recebe `429` e outro usuário não; 21ª chamada de upload recebe `429`; 11ª chamada de `POST /auth/login` pelo mesmo IP recebe `429`; 25 chamadas seguidas a `GET /videos/{public_id}` de um `public_id` inexistente recebem `404`, nenhuma `429` | `test/throttling.e2e-spec.ts` |

**Dependencies:** SI-04.1 — `throttleConfig.publicReadLimit`

**Acceptance criteria:**

- A 121ª chamada dentro de um minuto de um mesmo usuário a `GET /auth/me` retorna `429`, e uma chamada de outro usuário no mesmo minuto retorna `200`
- A 21ª chamada dentro de um minuto de um mesmo usuário a `POST /videos/{public_id}/upload/parts` retorna `429`
- A 11ª chamada dentro de um minuto do mesmo IP a `POST /auth/login` continua retornando `429`
- 25 chamadas seguidas a `GET /videos/{public_id}` com um `public_id` inexistente retornam `404`, nenhuma `429`
- Com `THROTTLE_PUBLIC_READ_LIMIT=5`, a 6ª chamada por minuto do mesmo IP a uma rota marcada com `PublicReadThrottle()` retorna `429`

---

### SI-04.4 — Criar a tabela de categorias, a lista inicial e o CategoriesModule

**Description:** Cria as categorias da plataforma como dados de referência versionados, com um serviço que as lista na ordem definida e resolve uma categoria pelo `slug` para a edição do vídeo.

**Technical actions:**

1. Criar `src/categories/entities/category.entity.ts` (`id`, `slug` único `UQ_categories_slug`, `name`) conforme `### Data Model → Category` e gerar a migration de schema pela CLI (`migration:generate`) (per `phase-04-gerenciamento/TD-03`; `.claude/rules/typeorm-migrations.md`)
2. Escrever à mão a migration de dados que insere as 11 categorias da lista inicial com os nomes de `### Data Model → Category`, com `down` que remove só esses `slug` (exceção de migration de dados de `.claude/rules/typeorm-migrations.md`) (per `phase-04-gerenciamento/TD-03`)
3. Criar `src/categories/categories.service.ts` com `findAll()` (ordem por `name`, `outros` por último) e `findBySlug(slug)` (devolve `null` quando não existe), e `src/categories/categories.module.ts` exportando o serviço; registrar o módulo no `AppModule` (per `phase-04-gerenciamento/TD-03`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Category` | Integration: `slug` único e `name` obrigatório | `src/categories/entities/category.entity.integration-spec.ts` |
| Migrations de categorias | Integration: `up` cria a tabela com as 11 linhas e `down` remove as linhas e a tabela | `src/database/migrations/categories.migration.integration-spec.ts` |
| `CategoriesService` | Integration: `findAll` na ordem exata esperada e `findBySlug` com slug existente e inexistente | `src/categories/categories.service.integration-spec.ts` |
| `CategoriesModule` | Unit: compilação da injeção de dependência | `src/categories/categories.module.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Depois de `migration:run`, a tabela `categories` tem exatamente os 11 `slug` da lista inicial
- `migration:revert` das duas migrations remove as linhas e a tabela sem erro, e `migration:run` seguinte as recria
- Inserir uma categoria com `slug` já existente falha pela restrição `UQ_categories_slug`
- `findAll` devolve as categorias ordenadas por `name`, com `outros` na última posição

---

### SI-04.5 — Endpoint GET /categories

**Route:** GET /categories
**Test Specs:** see `nestjs-project/specs/categories-list.plan.md`
**Authorization:** Anonymous — pública, throttler `public-read` (per `### Authorization Matrix`)

**Description:** Expõe a lista de categorias da plataforma sem autenticação, para o cliente oferecer a escolha na edição do vídeo.

**Technical actions:**

1. Criar `src/categories/dto/category-response.dto.ts` (`slug`, `name`) conforme `### API Contracts → GET /categories`
2. Criar `src/categories/categories.controller.ts` com `GET /categories` (200), `@Public()`, `PublicReadThrottle()`, `@ApiTags('categories')` e `@ApiResponse` do `429` com `ApiErrorEnvelope`, delegando a `CategoriesService.findAll` (per `phase-04-gerenciamento/TD-03`, `phase-04-gerenciamento/TD-11`; `.claude/rules/nestjs-controllers.md`)
3. Registrar o controller em `CategoriesModule`

**Tests:** _(empty — controller: cenários de E2E no spec de /plan-test-specs; a consulta está coberta em SI-04.4)_

**Dependencies:** SI-04.3 — throttler `public-read`; SI-04.4 — serviço de categorias

**Acceptance criteria:**

- `GET /categories` sem `Authorization` retorna `200` com 11 itens `{ slug, name }`, o último com `slug: "outros"`
- Nenhum item da resposta tem campo `id`
- 25 chamadas seguidas a `GET /categories` do mesmo IP retornam `200`, nenhuma `429`

---

### SI-04.6 — Acrescentar ao vídeo as colunas de edição, publicação, categoria e capa customizada

**Description:** Evolui a entidade e o repositório de vídeos com o modelo editorial da fase (visibilidade, publicação, descrição, categoria e capa customizada), mantendo o worker intocado e definindo num só lugar o predicado de vídeo listável.

**Technical actions:**

1. Acrescentar a `Video` (`src/videos/entities/video.entity.ts`) `description`, `category_id` com a relação many-to-one para `Category`, `visibility`, `published_at`, `custom_thumbnail_key`, as restrições `CHK_videos_visibility` e `CHK_videos_published_ready` e os índices `IDX_videos_channel_created` e `IDX_videos_channel_listable` (parcial), conforme `### Data Model → Video` (per `phase-04-gerenciamento/TD-01`, `phase-04-gerenciamento/TD-03`, `phase-04-gerenciamento/TD-06`, `phase-04-gerenciamento/TD-10`)
2. Gerar a migration de schema pela CLI e conferir que o índice parcial e as duas restrições saíram como em `### Data Model`; escrever à mão, antes da criação de `CHK_videos_published_ready`, o passo de dados que publica os vídeos `ready` existentes como `unlisted` com `published_at = now()`, com `down` que remove as colunas (per `phase-04-gerenciamento/TD-01`; `.claude/rules/typeorm-migrations.md`)
3. Acrescentar a `VideosRepository` o predicado listável (`published_at IS NOT NULL AND visibility = 'public'`) como único ponto de definição, `findByPublicIdWithRelations` (carrega `channel` e `category` em uma consulta) e `updateEditableFields(videoId, changes)`, que só aceita `title`, `description`, `category_id` e `visibility` (per `phase-04-gerenciamento/TD-01`, `phase-04-gerenciamento/TD-04`)
4. Acrescentar a `VideosRepository` `publish(videoId, visibility)` — `UPDATE` condicional `WHERE status = 'ready'` que grava `published_at = now()` e `visibility`, devolvendo se afetou linha —, `unpublish(videoId)` (zera `published_at`) e `setCustomThumbnailKey(videoId, key | null)` (per `phase-04-gerenciamento/TD-01`, `phase-04-gerenciamento/TD-06`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: padrão `visibility = 'public'`, `CHK_videos_visibility` rejeita outro valor, `CHK_videos_published_ready` rejeita `published_at` em vídeo não `ready`, `category_id` inexistente viola a FK | `src/videos/entities/video.entity.integration-spec.ts` |
| Migration dos campos de gerenciamento | Integration: vídeo `ready` preexistente vira `unlisted` publicado e vídeo `draft` fica sem `published_at`; `down` remove as colunas | `src/database/migrations/video-management.migration.integration-spec.ts` |
| `VideosRepository` | Integration: `publish` só afeta vídeo `ready`, `unpublish`, `updateEditableFields` ignora colunas fora da lista, `findByPublicIdWithRelations` traz canal e categoria, predicado listável | `src/videos/videos.repository.integration-spec.ts` |

**Dependencies:** SI-04.4 — a FK referencia `categories`

**Acceptance criteria:**

- Depois de `migration:run`, um vídeo `ready` criado antes da migration tem `visibility = 'unlisted'` e `published_at` preenchido, e um vídeo `processing` tem `visibility = 'public'` e `published_at` nulo
- Gravar `published_at` num vídeo `processing` falha pela restrição `CHK_videos_published_ready`
- Gravar `visibility = 'private'` falha pela restrição `CHK_videos_visibility`
- `publish` num vídeo `error` não altera a linha e devolve `false`; num vídeo `ready` grava `published_at` e a `visibility` pedida
- `migration:revert` remove as colunas novas sem erro, e o worker da Fase 03 continua levando um vídeo de `draft` a `ready` depois da migration

---

### SI-04.7 — Endpoint GET /videos/{public_id} (acesso por publicação e contrato ampliado)

**Route:** GET /videos/{public_id}
**Test Specs:** see `nestjs-project/specs/videos-get.plan.md`
**Authorization:** Optional — publicado para todos, rascunho só para o dono (per `### Authorization Matrix`)

**Description:** Aplica a regra de acesso da fase à leitura de metadados (rascunho só para o dono, na ordem `404` antes de `409`) e devolve a representação ampliada do vídeo, com cache privado.

**Technical actions:**

1. Criar `src/videos/video-access.service.ts` com `loadReadable(publicId, viewerUserId | undefined)`: carrega por `findByPublicIdWithRelations`, lança `VideoNotFoundException` quando o vídeo não existe ou quando `published_at` é nulo e o pedinte não é o dono do canal, e `VideoNotReadyException` quando o vídeo não é `ready` (per `phase-04-gerenciamento/TD-02`, Revision de `phase-03-videos/TD-07`)
2. Ampliar `VideoResponseDto` com `description`, `category` (`{ slug, name }` ou `null`), `visibility`, `published_at`, `thumbnail_url` e `updated_at`, e criar `src/videos/video-response.mapper.ts` com `toVideoResponse(video)` (`thumbnail_url` = `/videos/{public_id}/thumbnail`), conforme `### API Contracts → VideoResponse` (per `phase-04-gerenciamento/TD-04`, `phase-04-gerenciamento/TD-05`)
3. Trocar `VideosService.getReadyVideo` por `getVideo(publicId, viewerUserId)`, que usa `VideoAccessService` e o mapper
4. Em `VideosController`, trocar `@Public()` por `@OptionalAuth()` + `ApiOptionalBearerAuth()` na rota, manter `@SkipThrottle()`, ler o pedinte com `OptionalCurrentUser()` e responder com `Cache-Control: private, no-cache` (per `phase-04-gerenciamento/TD-02`, `phase-04-gerenciamento/TD-11`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoAccessService` | Unit: inexistente → `404`; rascunho para anônimo e para outro usuário → `404`; rascunho `ready` para o dono → vídeo; não `ready` para o dono → `409`; publicado para anônimo → vídeo (repositório mockado) | `src/videos/video-access.service.spec.ts` |
| `toVideoResponse` | Unit: campos novos, `category` nula, `thumbnail_url` e ausência de `id`, `channel_id` e chaves de storage | `src/videos/video-response.mapper.spec.ts` |

**Dependencies:** SI-04.2 — `@OptionalAuth()`; SI-04.6 — colunas e `findByPublicIdWithRelations`

**Acceptance criteria:**

- `GET /videos/{public_id}` de um vídeo publicado, sem `Authorization`, retorna `200` com `description`, `category`, `visibility`, `published_at`, `thumbnail_url` igual a `/videos/{public_id}/thumbnail` e `updated_at`, e cabeçalho `Cache-Control: private, no-cache`
- `GET /videos/{public_id}` de um vídeo `ready` em rascunho retorna `404` com `error: "VIDEO_NOT_FOUND"` para anônimo e para outro usuário autenticado, e `200` para o dono
- `GET /videos/{public_id}` de um vídeo `processing` retorna `404` para anônimo e `409` com `error: "VIDEO_NOT_READY"` para o dono
- `GET /videos/{public_id}` de um vídeo publicado com token expirado no `Authorization` retorna `200`, como anônimo
- A resposta não contém `id`, `channel_id`, `video_key`, `thumbnail_key` nem `custom_thumbnail_key`

---

### SI-04.8 — Endpoint GET /videos/{public_id}/stream (acesso por publicação)

**Route:** GET /videos/{public_id}/stream
**Test Specs:** see `nestjs-project/specs/videos-stream.plan.md`
**Authorization:** Optional — publicado para todos, rascunho só para o dono (per `### Authorization Matrix`)

**Description:** Aplica ao streaming a mesma regra de acesso dos metadados, sem mudar o comportamento de `Range`/206 nem carregar o arquivo em memória.

**Technical actions:**

1. Trocar em `VideoStreamingService.stream` o `loadReadyVideo` por `VideoAccessService.loadReadable(publicId, viewerUserId)` e o cabeçalho `Cache-Control` para `private, no-cache` (per `phase-04-gerenciamento/TD-02`, Revision de `phase-03-videos/TD-07`)
2. Em `VideosController`, trocar `@Public()` por `@OptionalAuth()` + `ApiOptionalBearerAuth()` na rota `stream`, manter `@SkipThrottle()` e passar o pedinte de `OptionalCurrentUser()` ao serviço (per `phase-04-gerenciamento/TD-11`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoStreamingService.stream` | Unit: rascunho para anônimo → `404`, rascunho para o dono → stream, `Cache-Control` igual a `private, no-cache` (acesso e storage mockados) | `src/videos/video-streaming.service.spec.ts` |

**Dependencies:** SI-04.7 — `VideoAccessService`

**Acceptance criteria:**

- `GET /videos/{public_id}/stream` de um vídeo publicado com `Range: bytes=0-1023` e sem `Authorization` retorna `206` com 1024 bytes e `Cache-Control: private, no-cache`
- `GET /videos/{public_id}/stream` de um vídeo em rascunho retorna `404` com `error: "VIDEO_NOT_FOUND"` para anônimo e `200` para o dono
- `GET /videos/{public_id}/stream` com `Range` fora do tamanho continua retornando `416` com `error: "INVALID_RANGE"` num vídeo publicado

---

### SI-04.9 — Endpoint GET /videos/{public_id}/download (acesso por publicação)

**Route:** GET /videos/{public_id}/download
**Test Specs:** see `nestjs-project/specs/videos-download.plan.md`
**Authorization:** Optional — publicado para todos, rascunho só para o dono (per `### Authorization Matrix`)

**Description:** Aplica ao download a mesma regra de acesso dos metadados e o cache privado, mantendo o arquivo em stream.

**Technical actions:**

1. Trocar em `VideoStreamingService.download` o `loadReadyVideo` por `VideoAccessService.loadReadable(publicId, viewerUserId)` e o cabeçalho `Cache-Control` para `private, no-cache`; remover `loadReadyVideo`, que fica sem uso (per `phase-04-gerenciamento/TD-02`, Revision de `phase-03-videos/TD-07`)
2. Em `VideosController`, trocar `@Public()` por `@OptionalAuth()` + `ApiOptionalBearerAuth()` na rota `download`, manter `@SkipThrottle()` e passar o pedinte de `OptionalCurrentUser()` ao serviço (per `phase-04-gerenciamento/TD-11`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoStreamingService.download` | Unit: rascunho para outro usuário → `404`, publicado → anexo com `Cache-Control` igual a `private, no-cache` (acesso e storage mockados) | `src/videos/video-streaming.service.spec.ts` |

**Dependencies:** SI-04.8 — o serviço de streaming já usa `VideoAccessService`

**Acceptance criteria:**

- `GET /videos/{public_id}/download` de um vídeo publicado sem `Authorization` retorna `200` com `Content-Disposition: attachment` e `Cache-Control: private, no-cache`
- `GET /videos/{public_id}/download` de um vídeo em rascunho retorna `404` com `error: "VIDEO_NOT_FOUND"` para outro usuário autenticado e `200` para o dono
- `GET /videos/{public_id}/download` de um vídeo `error` retorna `409` com `error: "VIDEO_NOT_READY"` para o dono

---

### SI-04.10 — Endpoint PATCH /videos/{public_id}

**Route:** PATCH /videos/{public_id}
**Test Specs:** see `nestjs-project/specs/videos-update.plan.md`
**Authorization:** Owner — dono do canal do vídeo; throttler `authenticated` (per `### Authorization Matrix`)

**Description:** Deixa o dono editar título, descrição, categoria e visibilidade de um vídeo seu, de forma parcial e em qualquer status de processamento, recusando corpo vazio e campos que o cliente não pode escrever.

**Technical actions:**

1. Criar `src/common/text/plain-text.util.ts` com a normalização e validação de texto puro de `### API Contracts → Validation Rules` (`trim` do título, quebras de linha para `\n`, rejeição de caracteres de controle exceto `\n` e `\t`) e o decorator de class-validator que a aplica; criar `src/videos/dto/update-video.dto.ts` (`title`, `description`, `category`, `visibility`, todos opcionais) (per `phase-04-gerenciamento/TD-04`, `phase-02-auth/TD-06`)
2. Extrair a verificação de dono de `VideoUploadsService.assertOwner` para `src/videos/video-ownership.service.ts` (`loadOwned(userId, publicId)`: inexistente → `VideoNotFoundException`, outro canal → `VideoAccessDeniedException`), usada pelo upload e pelas escritas desta fase; trocar a mensagem de `VideoAccessDeniedException` para não citar só o upload (per `### Error Catalog`)
3. Adicionar `InvalidCategoryException` (`INVALID_CATEGORY`, 400) a `src/common/exceptions/domain.exception.ts`; importar `CategoriesModule` em `VideosModule` (per `### Error Catalog`)
4. Criar `VideosService.update(userId, publicId, dto)`: corpo sem nenhum campo → `BadRequestException` (sai como `VALIDATION_ERROR` pelo filtro), resolve `category` pelo `slug` via `CategoriesService.findBySlug` (`null` limpa), grava por `updateEditableFields` e devolve `toVideoResponse` do vídeo relido; último a escrever vence, sem checagem de versão (per `phase-04-gerenciamento/TD-05`, `phase-04-gerenciamento/TD-01`)
5. Criar em `VideosController` `PATCH /videos/{public_id}` (200), `@ApiBearerAuth('access-token')`, `AuthenticatedThrottle()` e `@ApiResponse` de `400`, `401`, `403` e `404` com `ApiErrorEnvelope`, delegando a `VideosService.update` (per `.claude/rules/nestjs-controllers.md`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `plain-text.util` | Unit: `trim`, `\r\n` e `\r` viram `\n`, `\t` aceito, `\u0000` e `\u001b` rejeitados, HTML mantido como texto | `src/common/text/plain-text.util.spec.ts` |
| `VideoOwnershipService` | Unit: inexistente → `404`, outro canal → `403`, dono → vídeo (repositório e canais mockados) | `src/videos/video-ownership.service.spec.ts` |
| `VideosService.update` | Unit: corpo vazio → `400`, slug inexistente → `INVALID_CATEGORY`, `category: null` limpa, só campos enviados mudam | `src/videos/videos.service.spec.ts` |
| `VideosService.update` | Integration: edição num vídeo `processing` persiste sem tocar `status` e `thumbnail_key`, e a resposta traz o `updated_at` novo | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-04.3 — throttler `authenticated`; SI-04.7 — mapper e `findByPublicIdWithRelations`

**Acceptance criteria:**

- `PATCH /videos/{public_id}` do dono com `{ "title": "  Novo título  ", "category": "musica" }` retorna `200` com `title: "Novo título"`, `category: { "slug": "musica", "name": "Música" }` e `updated_at` posterior ao anterior
- `PATCH /videos/{public_id}` do dono com `{ "description": null }` retorna `200` com `description: null`, sem alterar `title`
- `PATCH /videos/{public_id}` com `{}` retorna `400` com `error: "VALIDATION_ERROR"`
- `PATCH /videos/{public_id}` com `{ "status": "ready" }`, `{ "video_key": "x" }` ou `{ "channel_id": "…" }` retorna `400` e o vídeo não muda
- `PATCH /videos/{public_id}` com `title` vazio após `trim` ou com 101 caracteres retorna `400` com `error: "VALIDATION_ERROR"`
- `PATCH /videos/{public_id}` com `{ "category": "inexistente" }` retorna `400` com `error: "INVALID_CATEGORY"`
- `PATCH /videos/{public_id}` de outro usuário retorna `403` com `error: "VIDEO_ACCESS_DENIED"`, sem token `401`, e com `public_id` inexistente `404` com `error: "VIDEO_NOT_FOUND"`
- `PATCH /videos/{public_id}` com `{ "visibility": "unlisted" }` num vídeo publicado retorna `200` com `visibility: "unlisted"` e o mesmo `published_at`

---

### SI-04.11 — Endpoint POST /videos/{public_id}/publication

**Route:** POST /videos/{public_id}/publication
**Test Specs:** see `nestjs-project/specs/videos-publish.plan.md`
**Authorization:** Owner — dono do canal do vídeo; throttler `authenticated` (per `### Authorization Matrix`)

**Description:** Publica um vídeo pronto, com visibilidade pública por padrão ou não listada, gravando o instante da publicação a cada chamada.

**Technical actions:**

1. Criar `src/videos/dto/publish-video.dto.ts` (`visibility` opcional, `public` | `unlisted`) (per `phase-04-gerenciamento/TD-01`)
2. Adicionar `VideoNotPublishableException` (`VIDEO_NOT_PUBLISHABLE`, 409) a `src/common/exceptions/domain.exception.ts` (per `### Error Catalog`)
3. Criar `src/videos/video-publication.service.ts` com `publish(userId, publicId, visibility = 'public')`: `VideoOwnershipService.loadOwned`, depois `VideosRepository.publish`; `false` (vídeo não `ready`) → `VideoNotPublishableException`; devolve `toVideoResponse` do vídeo relido (per `phase-04-gerenciamento/TD-01`)
4. Criar em `VideosController` `POST /videos/{public_id}/publication` (200), `@ApiBearerAuth('access-token')`, `AuthenticatedThrottle()` e `@ApiResponse` de `400`, `401`, `403`, `404` e `409` com `ApiErrorEnvelope`; registrar o serviço em `VideosModule` (per `.claude/rules/nestjs-controllers.md`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoPublicationService.publish` | Unit: não `ready` → `VIDEO_NOT_PUBLISHABLE`, `visibility` padrão `public`, dono verificado antes de escrever (repositório mockado) | `src/videos/video-publication.service.spec.ts` |
| `VideoPublicationService.publish` | Integration: publicar duas vezes grava um `published_at` novo na segunda; publicar um vídeo `processing` não altera a linha | `src/videos/video-publication.service.integration-spec.ts` |

**Dependencies:** SI-04.10 — `VideoOwnershipService`

**Acceptance criteria:**

- `POST /videos/{public_id}/publication` do dono num vídeo `ready`, sem corpo, retorna `200` com `visibility: "public"` e `published_at` preenchido, e em seguida `GET /videos/{public_id}` sem `Authorization` retorna `200`
- `POST /videos/{public_id}/publication` com `{ "visibility": "unlisted" }` retorna `200` com `visibility: "unlisted"`
- Repetir `POST /videos/{public_id}/publication` num vídeo já publicado retorna `200` com um `published_at` posterior ao anterior
- `POST /videos/{public_id}/publication` num vídeo `processing` retorna `409` com `error: "VIDEO_NOT_PUBLISHABLE"` e o vídeo continua sem `published_at`
- `POST /videos/{public_id}/publication` com `{ "visibility": "private" }` retorna `400` com `error: "VALIDATION_ERROR"`
- `POST /videos/{public_id}/publication` de outro usuário retorna `403` com `error: "VIDEO_ACCESS_DENIED"` e sem token `401`

---

### SI-04.12 — Endpoint DELETE /videos/{public_id}/publication

**Route:** DELETE /videos/{public_id}/publication
**Test Specs:** see `nestjs-project/specs/videos-unpublish.plan.md`
**Authorization:** Owner — dono do canal do vídeo; throttler `authenticated` (per `### Authorization Matrix`)

**Description:** Despublica um vídeo, que volta a rascunho e deixa de ser lido por quem não é o dono, de forma idempotente.

**Technical actions:**

1. Criar `VideoPublicationService.unpublish(userId, publicId)`: `VideoOwnershipService.loadOwned`, depois `VideosRepository.unpublish` (zera `published_at`, mantém `visibility`); vídeo já em rascunho não é erro (per `phase-04-gerenciamento/TD-01`)
2. Criar em `VideosController` `DELETE /videos/{public_id}/publication` (204), `@ApiBearerAuth('access-token')`, `AuthenticatedThrottle()` e `@ApiResponse` de `401`, `403` e `404` com `ApiErrorEnvelope` (per `.claude/rules/nestjs-controllers.md`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoPublicationService.unpublish` | Unit: dono verificado antes de escrever, rascunho sem erro (repositório mockado) | `src/videos/video-publication.service.spec.ts` |

**Dependencies:** SI-04.11 — `VideoPublicationService`

**Acceptance criteria:**

- `DELETE /videos/{public_id}/publication` do dono num vídeo publicado retorna `204`, e em seguida `GET /videos/{public_id}`, `/stream` e `/download` sem `Authorization` retornam `404` com `error: "VIDEO_NOT_FOUND"` enquanto o dono continua recebendo `200`
- Depois de despublicar, o vídeo mantém a `visibility` que tinha
- `DELETE /videos/{public_id}/publication` num vídeo em rascunho retorna `204`
- `DELETE /videos/{public_id}/publication` de outro usuário retorna `403` com `error: "VIDEO_ACCESS_DENIED"`, sem token `401` e com `public_id` inexistente `404`

---

### SI-04.13 — Implementar o normalizador de imagem da capa com ffmpeg em pipe

**Description:** Valida pelo conteúdo e regrava como JPEG de 640 px a imagem enviada como capa, com teto de pixels, limite de memória e tempo, sem arquivo temporário nem acesso à rede — o conteúdo é não confiável.

**Technical actions:**

1. Criar `src/videos/thumbnails/image-header.util.ts`: identifica JPEG (`FF D8 FF`), PNG (`89 50 4E 47 0D 0A 1A 0A`) ou WebP (`RIFF`…`WEBP`) pelos bytes iniciais, lê largura e altura do cabeçalho (SOF do JPEG, IHDR do PNG, chunk VP8/VP8L/VP8X do WebP) e marca WebP animado (flag de animação do VP8X ou chunk `ANIM`) (per `phase-04-gerenciamento/TD-07`)
2. Adicionar `InvalidImageException` (`INVALID_IMAGE`, 415) a `src/common/exceptions/domain.exception.ts` (per `### Error Catalog`)
3. Criar `src/videos/thumbnails/image-normalizer.service.ts` com `normalize(buffer)`: formato desconhecido, largura × altura acima de `videoConfig.thumbnailMaxPixels` ou WebP animado → `InvalidImageException` antes de decodificar; senão executa `ffmpeg` por `spawn`, sem shell, com `-v error -nostdin -protocol_whitelist pipe -max_alloc 134217728 -f <jpeg_pipe|png_pipe|webp_pipe> -i pipe:0 -frames:v 1 -vf scale=640:-2 -c:v mjpeg -f image2 pipe:1` (o `-max_alloc` de 128 MiB é escolha deste plano), escrevendo o buffer no stdin e lendo o JPEG do stdout (per `phase-04-gerenciamento/TD-07`)
4. Encerrar o processo e lançar `InvalidImageException` quando o `ffmpeg` sai com código diferente de zero, não produz bytes ou passa de `videoConfig.thumbnailDecodeTimeoutMs`; registrar o serviço em `VideosModule` (per `phase-04-gerenciamento/TD-07`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `image-header.util` | Unit: os três formatos e suas dimensões, texto com extensão de imagem recusado, WebP animado marcado, cabeçalho truncado | `src/videos/thumbnails/image-header.util.spec.ts` |
| `ImageNormalizerService` | Integration: com o `ffmpeg` real do contêiner, JPEG com EXIF, PNG e WebP viram JPEG de 640 px de largura sem EXIF; PNG com 16000 × 16000 é recusado sem chamar o `ffmpeg`; PNG corrompido é recusado; timeout curto encerra o processo | `src/videos/thumbnails/image-normalizer.service.integration-spec.ts` |

**Dependencies:** SI-04.1 — `thumbnailMaxPixels` e `thumbnailDecodeTimeoutMs`

**Acceptance criteria:**

- Um JPEG de 1920 × 1080 com EXIF de GPS sai como JPEG de 640 × 360 sem segmento EXIF
- Um PNG de 800 × 600 e um WebP estático saem como JPEG de 640 px de largura
- Um arquivo de texto com extensão `.png` e `Content-Type: image/png` é recusado com `INVALID_IMAGE`
- Um PNG de 16000 × 16000 é recusado com `INVALID_IMAGE` antes de qualquer processo `ffmpeg` ser iniciado
- Um WebP animado é recusado com `INVALID_IMAGE`
- Uma decodificação que passa de `VIDEO_THUMBNAIL_TIMEOUT_MS` termina com `INVALID_IMAGE` e sem processo `ffmpeg` restante

---

### SI-04.14 — Endpoint GET /videos/{public_id}/thumbnail

**Route:** GET /videos/{public_id}/thumbnail
**Test Specs:** see `nestjs-project/specs/videos-thumbnail-get.plan.md`
**Authorization:** Optional — publicado para todos, rascunho só para o dono; throttler `public-read` (per `### Authorization Matrix`)

**Description:** Serve a capa do vídeo — a customizada se existir, senão a gerada pelo worker — em stream do storage, com as regras de acesso do vídeo.

**Technical actions:**

1. Criar `src/videos/thumbnails/video-thumbnails.service.ts` com `getThumbnail(publicId, viewerUserId)`: `VideoAccessService.loadReadable`, escolhe `custom_thumbnail_key` ou `thumbnail_key` (nenhuma → `VideoNotFoundException`) e lê o objeto do bucket `thumbnails` por `StorageService.getObjectRange`, devolvendo corpo em stream e cabeçalhos (`Content-Type: image/jpeg`, `Content-Length`, `ETag` quando houver, `Cache-Control: private, no-cache`) (per `phase-04-gerenciamento/TD-06`, `phase-04-gerenciamento/TD-02`)
2. Criar em `VideosController` `GET /videos/{public_id}/thumbnail` (200, `image/jpeg`) com `@OptionalAuth()`, `ApiOptionalBearerAuth()`, `PublicReadThrottle()`, `@ApiResponse` de `404`, `409`, `429` e `502`, e o corpo entregue pelo mesmo `pipeStorageBody` do streaming (fecha o stream do storage quando o cliente sai); registrar o serviço em `VideosModule` (per `phase-04-gerenciamento/TD-11`; `.claude/rules/nestjs-controllers.md`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoThumbnailsService.getThumbnail` | Unit: prefere a customizada, cai na gerada, sem nenhuma chave → `404`, rascunho para anônimo → `404` (acesso e storage mockados) | `src/videos/thumbnails/video-thumbnails.service.spec.ts` |
| `VideoThumbnailsService.getThumbnail` | Integration: lê do MinIO real a capa gerada gravada em `thumbnails/{videoId}/default.jpg` | `src/videos/thumbnails/video-thumbnails.service.integration-spec.ts` |

**Dependencies:** SI-04.3 — throttler `public-read`; SI-04.7 — `VideoAccessService`

**Acceptance criteria:**

- `GET /videos/{public_id}/thumbnail` de um vídeo publicado sem capa customizada, sem `Authorization`, retorna `200` com `Content-Type: image/jpeg`, os bytes de `thumbnails/{videoId}/default.jpg` e `Cache-Control: private, no-cache`
- `GET /videos/{public_id}/thumbnail` de um vídeo em rascunho retorna `404` com `error: "VIDEO_NOT_FOUND"` para anônimo e `200` para o dono
- `GET /videos/{public_id}/thumbnail` de um vídeo `processing` retorna `409` com `error: "VIDEO_NOT_READY"` para o dono
- 25 chamadas seguidas a `GET /videos/{public_id}/thumbnail` do mesmo IP não recebem `429`

---

### SI-04.15 — Endpoint PUT /videos/{public_id}/thumbnail

**Route:** PUT /videos/{public_id}/thumbnail
**Test Specs:** see `nestjs-project/specs/videos-thumbnail-set.plan.md`
**Authorization:** Owner — dono do canal do vídeo; throttler `uploads` (per `### Authorization Matrix`)

**Description:** Deixa o dono trocar a capa do vídeo por uma imagem própria, validada pelo conteúdo e regravada antes de chegar ao storage, sem que o worker jamais a sobrescreva.

**Technical actions:**

1. Adicionar `ImageTooLargeException` (`IMAGE_TOO_LARGE`, 413) a `src/common/exceptions/domain.exception.ts` (per `### Error Catalog`)
2. Criar `VideoThumbnailsService.setCustom(userId, publicId, buffer)`: `VideoOwnershipService.loadOwned`, `ImageNormalizerService.normalize`, `StorageService.putObject` no bucket `thumbnails` com a chave `{videoId}/custom.jpg` e `Content-Type: image/jpeg`, e só depois `VideosRepository.setCustomThumbnailKey` (per `phase-04-gerenciamento/TD-06`, `phase-04-gerenciamento/TD-07`)
3. Criar em `VideosController` `PUT /videos/{public_id}/thumbnail` (204) com `FileInterceptor('file', { limits: { fileSize: 2097152 } })` — o `limits.fileSize` do Multer corta o corpo enquanto chega — convertendo o estouro do limite em `ImageTooLargeException` e a ausência de `file` em `400 VALIDATION_ERROR`; `@ApiBearerAuth('access-token')`, `@ApiConsumes('multipart/form-data')`, `UploadsThrottle()` e `@ApiResponse` de `400`, `401`, `403`, `404`, `413`, `415` e `502` (per `phase-04-gerenciamento/TD-06`, `phase-04-gerenciamento/TD-11`; `.claude/rules/nestjs-controllers.md`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoThumbnailsService.setCustom` | Unit: dono verificado antes de decodificar, imagem inválida não grava nada, chave gravada só depois do `putObject` (dependências mockadas) | `src/videos/thumbnails/video-thumbnails.service.spec.ts` |
| `VideoThumbnailsService.setCustom` | Integration: imagem real normalizada e gravada no MinIO, `custom_thumbnail_key` preenchida | `src/videos/thumbnails/video-thumbnails.service.integration-spec.ts` |
| `VideoProcessor` | Integration: reprocessar um vídeo com capa customizada não altera `custom_thumbnail_key` nem o objeto `custom.jpg` | `src/worker/video.processor.integration-spec.ts` |

**Dependencies:** SI-04.13 — normalizador; SI-04.14 — `VideoThumbnailsService`

**Acceptance criteria:**

- `PUT /videos/{public_id}/thumbnail` do dono com um PNG válido no campo `file` retorna `204`, e em seguida `GET /videos/{public_id}/thumbnail` do dono retorna um JPEG de 640 px de largura diferente da capa gerada
- `PUT /videos/{public_id}/thumbnail` com um arquivo de texto enviado como `image/png` retorna `415` com `error: "INVALID_IMAGE"` e a capa não muda
- `PUT /videos/{public_id}/thumbnail` com um arquivo de 2097153 bytes retorna `413` com `error: "IMAGE_TOO_LARGE"`
- `PUT /videos/{public_id}/thumbnail` sem o campo `file` retorna `400` com `error: "VALIDATION_ERROR"`
- `PUT /videos/{public_id}/thumbnail` de outro usuário retorna `403` com `error: "VIDEO_ACCESS_DENIED"` e sem token `401`
- `PUT /videos/{public_id}/thumbnail` num vídeo `processing` retorna `204`, e depois que o worker leva o vídeo a `ready` a capa servida continua sendo a customizada

---

### SI-04.16 — Endpoint DELETE /videos/{public_id}/thumbnail

**Route:** DELETE /videos/{public_id}/thumbnail
**Test Specs:** see `nestjs-project/specs/videos-thumbnail-delete.plan.md`
**Authorization:** Owner — dono do canal do vídeo; throttler `uploads` (per `### Authorization Matrix`)

**Description:** Remove a capa customizada e devolve o vídeo à capa gerada pelo worker, de forma idempotente.

**Technical actions:**

1. Acrescentar a `StorageService` o método `deleteObject(bucket, key)` (falha de comunicação → `StorageUnavailableException`; objeto inexistente não é erro) (per `phase-03-videos/TD-09`)
2. Criar `VideoThumbnailsService.removeCustom(userId, publicId)`: `VideoOwnershipService.loadOwned`; com `custom_thumbnail_key` preenchida, zera a coluna por `setCustomThumbnailKey(videoId, null)` e remove o objeto; sem capa customizada, não faz nada (per `phase-04-gerenciamento/TD-06`)
3. Criar em `VideosController` `DELETE /videos/{public_id}/thumbnail` (204), `@ApiBearerAuth('access-token')`, `UploadsThrottle()` e `@ApiResponse` de `401`, `403`, `404` e `502` (per `.claude/rules/nestjs-controllers.md`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService.deleteObject` | Integration: remove o objeto do MinIO real e aceita chave inexistente | `src/storage/storage.service.integration-spec.ts` |
| `VideoThumbnailsService.removeCustom` | Unit: dono verificado, sem capa customizada não chama o storage, com capa zera a coluna e remove o objeto (dependências mockadas) | `src/videos/thumbnails/video-thumbnails.service.spec.ts` |

**Dependencies:** SI-04.15 — capa customizada gravada

**Acceptance criteria:**

- `DELETE /videos/{public_id}/thumbnail` do dono num vídeo com capa customizada retorna `204`, e em seguida `GET /videos/{public_id}/thumbnail` devolve de novo os bytes de `thumbnails/{videoId}/default.jpg`
- Depois do `DELETE`, o objeto `thumbnails/{videoId}/custom.jpg` não existe no bucket
- `DELETE /videos/{public_id}/thumbnail` num vídeo sem capa customizada retorna `204`
- `DELETE /videos/{public_id}/thumbnail` de outro usuário retorna `403` com `error: "VIDEO_ACCESS_DENIED"` e sem token `401`

---

### SI-04.17 — Aplicar as regras de nickname na validação e na geração do cadastro

**Description:** Centraliza o formato e a lista de nicknames reservados, usados pela edição do canal, e faz o cadastro deixar de gerar nicknames reservados ou curtos, sem invalidar os já gravados.

**Technical actions:**

1. Acrescentar a `src/channels/nickname.util.ts` `NICKNAME_PATTERN` (`^[a-z0-9_]{3,50}$`), `RESERVED_NICKNAMES` (`me`, `admin`, `api`, `channels`, `videos`, `categories`, `auth`, `docs`, `support`) e `isReservedNickname(nickname)` (per `phase-04-gerenciamento/TD-08`)
2. Alterar `sanitizeNickname` para que prefixo reservado ou com menos de 3 caracteres receba o sufixo aleatório de `appendRandomSuffix` (prefixo vazio mantém o `user_<8-char-random>`), sem mudar a lista `[a-z0-9_]` (per Revision de `phase-02-auth/TD-10`)
3. Confirmar que `ChannelsService.createChannel` continua passando pela geração alterada e que nenhuma migration toca nicknames existentes (leitura pública aceita legados) (per `phase-04-gerenciamento/TD-08`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `nickname.util` | Unit: prefixos `admin`, `me` e `ab` recebem sufixo, `joao_silva` fica igual, prefixo vazio vira `user_…`, `isReservedNickname` e `NICKNAME_PATTERN` nos limites de 2, 3, 50 e 51 caracteres | `src/channels/nickname.util.spec.ts` |
| `ChannelsService.createChannel` | Integration: cadastro com e-mail `admin@exemplo.com` cria canal com nickname diferente de `admin` e compatível com `NICKNAME_PATTERN` | `src/channels/channels.service.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `POST /auth/register` com e-mail `admin@exemplo.com` cria um canal cujo nickname começa com `admin_` e não é `admin`
- `POST /auth/register` com e-mail `jo@exemplo.com` cria um canal com nickname de 3 caracteres ou mais
- `POST /auth/register` com e-mail `maria@exemplo.com` continua criando o nickname `maria` quando está livre

---

### SI-04.18 — Implementar o VideoListingsModule com as consultas do painel, da página pública e do `video_count`

**Description:** Reúne no módulo de vídeos as consultas paginadas por canal que o controller de canais vai expor, com um só `SELECT` por página, sem N+1, usando os índices da fase e o predicado listável único.

**Technical actions:**

1. Criar `src/common/pagination/pagination-query.dto.ts` (`page` ≥ 1 padrão 1, `limit` 1–50 padrão 20, com `class-transformer`) e `src/common/pagination/paginated.ts` (`{ items, page, limit, total, total_pages }`) conforme `### API Contracts → Paginação` (per `phase-04-gerenciamento/TD-09`)
2. Acrescentar a `VideosRepository` `findPanelPage(channelId, page, limit)` (todos os status, `category` por join, ordem `created_at DESC, id DESC`, com `COUNT` do mesmo filtro), `findListablePage(channelId, page, limit)` (predicado listável, ordem `published_at DESC, id DESC`) e `countListable(channelId)` (per `phase-04-gerenciamento/TD-10`)
3. Criar `src/videos/listing/video-listings.service.ts` com `listPanel`, `listPublic` e `countListable`, mapeando os itens para `### API Contracts → GET /channels/me/videos` (com `views`, `likes` e `comments` iguais a `0`) e `→ GET /channels/{nickname}/videos`, e os DTOs em `src/videos/listing/dto/` (per `phase-04-gerenciamento/TD-09`)
4. Criar `src/videos/listing/video-listings.module.ts`, que importa só `VideosRepositoryModule` e exporta `VideoListingsService`, para o módulo de canais consumir sem ciclo com `VideosModule` (per `phase-04-gerenciamento/TD-08`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosRepository` (listagens) | Integration: painel com vídeos nos quatro status e empate de `created_at` desempatado por `id`; lista pública exclui rascunho, `unlisted` e vídeo de outro canal; `countListable` igual ao total da lista pública; plano de consulta com `EXPLAIN` usa `IDX_videos_channel_listable` | `src/videos/videos.repository.integration-spec.ts` |
| `VideoListingsService` | Unit: `total_pages` arredondado para cima, página além da última com `items: []`, contadores `0` (repositório mockado) | `src/videos/listing/video-listings.service.spec.ts` |
| `VideoListingsModule` | Unit: compilação da injeção de dependência | `src/videos/listing/video-listings.module.spec.ts` |

**Dependencies:** SI-04.6 — colunas, índices e predicado listável

**Acceptance criteria:**

- Num canal com 45 vídeos, a página 3 do painel com `limit` 20 traz 5 itens, `total: 45` e `total_pages: 3`, na ordem `created_at` decrescente
- A lista pública de um canal com vídeos em rascunho, `unlisted` publicados e públicos publicados traz só os públicos publicados, por `published_at` decrescente
- `countListable` de um canal é igual ao `total` da sua lista pública
- Carregar uma página do painel com 20 itens com categoria executa uma única consulta de itens e uma de contagem

---

### SI-04.19 — Endpoint PATCH /channels/me

**Route:** PATCH /channels/me
**Test Specs:** see `nestjs-project/specs/channels-update-me.plan.md`
**Authorization:** Authenticated — só o canal do usuário do JWT; throttler `authenticated` (per `### Authorization Matrix`)

**Description:** Deixa o dono editar nickname, nome e descrição do próprio canal, com o conflito de nickname decidido pelo banco, inclusive sob concorrência.

**Technical actions:**

1. Adicionar `NicknameAlreadyExistsException` (`NICKNAME_ALREADY_EXISTS`, 409) e `NicknameReservedException` (`NICKNAME_RESERVED`, 400) a `src/common/exceptions/domain.exception.ts` (per `### Error Catalog`)
2. Criar `src/channels/dto/update-channel.dto.ts` (`nickname` com `NICKNAME_PATTERN`, `name` 1–50 e `description` até 5.000 ou `null`, com o texto puro de `plain-text.util`) e `src/channels/dto/channel-response.dto.ts` (`name`, `nickname`, `description`, `created_at`) (per `phase-04-gerenciamento/TD-08`, `phase-04-gerenciamento/TD-04`)
3. Criar `ChannelsService.updateOwn(userId, dto)`: corpo sem nenhum campo → `BadRequestException`; canal do usuário ausente → `ChannelNotFoundException`; nickname reservado → `NicknameReservedException`; grava e converte a violação do `UNIQUE` de `nickname` (reusa `isPgUniqueViolationOnColumn`) em `NicknameAlreadyExistsException`, sem consulta prévia de existência (per `phase-04-gerenciamento/TD-08`)
4. Criar `src/channels/channels.controller.ts` (`@ApiTags('channels')`, `@Controller('channels')`) com `PATCH /channels/me` (200), `@ApiBearerAuth('access-token')`, `AuthenticatedThrottle()` e `@ApiResponse` de `400`, `401`, `404` e `409`; registrar em `ChannelsModule` (per `.claude/rules/nestjs-controllers.md`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `ChannelsService.updateOwn` | Unit: corpo vazio → `400`, reservado → `NICKNAME_RESERVED`, violação do `UNIQUE` → `NICKNAME_ALREADY_EXISTS`, sem canal → `CHANNEL_NOT_FOUND` (repositório mockado) | `src/channels/channels.service.spec.ts` |
| `ChannelsService.updateOwn` | Integration: duas trocas simultâneas para o mesmo nickname deixam um vencedor e a outra falha com `NICKNAME_ALREADY_EXISTS` | `src/channels/channels.service.integration-spec.ts` |

**Dependencies:** SI-04.3 — throttler `authenticated`; SI-04.10 — `plain-text.util`; SI-04.17 — regras de nickname

**Acceptance criteria:**

- `PATCH /channels/me` com `{ "nickname": "novo_nome", "name": "Meu Canal", "description": "Sobre" }` retorna `200` com os três valores e `created_at`, sem `id`, `user_id` nem e-mail
- `PATCH /channels/me` com `{ "nickname": "admin" }` retorna `400` com `error: "NICKNAME_RESERVED"`
- `PATCH /channels/me` com `{ "nickname": "ab" }` ou `{ "nickname": "Com-Hifen" }` retorna `400` com `error: "VALIDATION_ERROR"`
- `PATCH /channels/me` com o nickname de outro canal retorna `409` com `error: "NICKNAME_ALREADY_EXISTS"` e o canal não muda
- `PATCH /channels/me` com `{}` ou com o campo `user_id` retorna `400` com `error: "VALIDATION_ERROR"`
- `PATCH /channels/me` sem `Authorization` retorna `401`

---

### SI-04.20 — Endpoint GET /channels/{nickname}

**Route:** GET /channels/{nickname}
**Test Specs:** see `nestjs-project/specs/channels-get.plan.md`
**Authorization:** Anonymous — pública, throttler `public-read` (per `### Authorization Matrix`)

**Description:** Expõe as informações públicas de um canal pelo nickname, com a contagem de vídeos listáveis, sem dados do usuário.

**Technical actions:**

1. Criar `ChannelsService.findByNickname(nickname)` (inexistente → `ChannelNotFoundException`; aceita qualquer nickname gravado, sem aplicar `NICKNAME_PATTERN`) e trocar a mensagem de `ChannelNotFoundException` para não citar só o usuário autenticado (per `phase-04-gerenciamento/TD-08`, `### Error Catalog`)
2. Criar `src/channels/dto/public-channel-response.dto.ts` (`name`, `nickname`, `description`, `created_at`, `video_count`) (per `phase-04-gerenciamento/TD-08`)
3. Importar `VideoListingsModule` em `ChannelsModule` e criar em `ChannelsController` `GET /channels/{nickname}` (200) com `@Public()`, `PublicReadThrottle()` e `@ApiResponse` de `404` e `429`, que resolve o canal por `ChannelsService.findByNickname` e obtém `video_count` por `VideoListingsService.countListable` — o `ChannelsService` não consulta `Video` (per `phase-04-gerenciamento/TD-08`, `phase-04-gerenciamento/TD-11`; `.claude/rules/nestjs-controllers.md`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `ChannelsService.findByNickname` | Integration: encontra nickname legado de 2 caracteres e lança `CHANNEL_NOT_FOUND` para inexistente | `src/channels/channels.service.integration-spec.ts` |

**Dependencies:** SI-04.18 — `countListable`; SI-04.19 — `ChannelsController`

**Acceptance criteria:**

- `GET /channels/{nickname}` sem `Authorization` retorna `200` com `name`, `nickname`, `description`, `created_at` e `video_count`, sem `id`, `user_id` nem e-mail
- `video_count` conta só os vídeos publicados e públicos: um canal com um vídeo público publicado, um `unlisted` publicado e um rascunho tem `video_count: 1`
- `GET /channels/inexistente` retorna `404` com `error: "CHANNEL_NOT_FOUND"`
- Depois de `PATCH /channels/me` trocar o nickname, `GET /channels/{nickname antigo}` retorna `404` e `GET /channels/{nickname novo}` retorna `200`
- 25 chamadas seguidas a `GET /channels/{nickname}` do mesmo IP não recebem `429`

---

### SI-04.21 — Endpoint GET /channels/me/videos (painel)

**Route:** GET /channels/me/videos
**Test Specs:** see `nestjs-project/specs/channels-me-videos.plan.md`
**Authorization:** Authenticated — só o canal do usuário do JWT; throttler `authenticated` (per `### Authorization Matrix`)

**Description:** Entrega ao dono a listagem paginada de todos os vídeos do próprio canal, em qualquer status, com as informações de gestão de onde ele parte para a edição.

**Technical actions:**

1. Criar em `ChannelsController` `GET /channels/me/videos` (200), declarado **antes** das rotas `/channels/{nickname}…` para o Express não tratar `me` como nickname, com `@ApiBearerAuth('access-token')`, `AuthenticatedThrottle()`, `@Query()` de `PaginationQueryDto` e `@ApiResponse` de `400`, `401` e `404` (per `phase-04-gerenciamento/TD-09`, `phase-04-gerenciamento/TD-11`; `.claude/rules/nestjs-controllers.md`)
2. O handler resolve o canal por `ChannelsService.findByUserId` (ausente → `ChannelNotFoundException`) e delega a `VideoListingsService.listPanel(channel.id, page, limit)`; não existe parâmetro de canal (per `phase-04-gerenciamento/TD-09`)

**Tests:** _(empty — controller: cenários de E2E no spec de /plan-test-specs; consulta e mapeamento cobertos em SI-04.18)_

**Dependencies:** SI-04.18 — `listPanel`; SI-04.20 — `ChannelsController` com `VideoListingsModule`

**Acceptance criteria:**

- `GET /channels/me/videos` do dono de um canal com vídeos em `draft`, `processing`, `ready` e `error` retorna `200` com os quatro, cada item com `public_id`, `title`, `thumbnail_url`, `category`, `status`, `visibility`, `published_at`, `created_at` e `views`, `likes` e `comments` iguais a `0`
- `GET /channels/me/videos` de outro usuário não traz nenhum vídeo do primeiro canal
- `GET /channels/me/videos?page=2&limit=1` retorna o segundo vídeo mais recente, `total` e `total_pages`
- `GET /channels/me/videos?limit=51` ou `?page=0` retorna `400` com `error: "VALIDATION_ERROR"`
- `GET /channels/me/videos` sem `Authorization` retorna `401`
- Com um canal cujo nickname gravado é `me`, `GET /channels/me/videos` do dono continua devolvendo o painel do usuário autenticado

---

### SI-04.22 — Endpoint GET /channels/{nickname}/videos

**Route:** GET /channels/{nickname}/videos
**Test Specs:** see `nestjs-project/specs/channels-videos.plan.md`
**Authorization:** Anonymous — pública, só vídeos listáveis; throttler `public-read` (per `### Authorization Matrix`)

**Description:** Lista publicamente os vídeos publicados e públicos de um canal, mais recentes primeiro, com paginação.

**Technical actions:**

1. Criar em `ChannelsController` `GET /channels/{nickname}/videos` (200) com `@Public()`, `PublicReadThrottle()`, `@Query()` de `PaginationQueryDto` e `@ApiResponse` de `400`, `404` e `429` (per `phase-04-gerenciamento/TD-09`, `phase-04-gerenciamento/TD-11`; `.claude/rules/nestjs-controllers.md`)
2. O handler resolve o canal por `ChannelsService.findByNickname` e delega a `VideoListingsService.listPublic(channel.id, page, limit)` (per `phase-04-gerenciamento/TD-08`, `phase-04-gerenciamento/TD-10`)

**Tests:** _(empty — controller: cenários de E2E no spec de /plan-test-specs; consulta e mapeamento cobertos em SI-04.18)_

**Dependencies:** SI-04.20 — `findByNickname` e o controller com `VideoListingsModule`

**Acceptance criteria:**

- `GET /channels/{nickname}/videos` sem `Authorization` retorna `200` só com os vídeos publicados e públicos do canal, cada item com `public_id`, `title`, `thumbnail_url`, `duration_seconds` e `published_at`, por `published_at` decrescente
- Um vídeo `unlisted` publicado e um vídeo em rascunho do canal não aparecem na listagem, e o `unlisted` continua respondendo `200` em `GET /videos/{public_id}`
- `GET /channels/inexistente/videos` retorna `404` com `error: "CHANNEL_NOT_FOUND"`
- `GET /channels/{nickname}/videos?limit=0` retorna `400` com `error: "VALIDATION_ERROR"`
- 25 chamadas seguidas a `GET /channels/{nickname}/videos` do mesmo IP não recebem `429`

---

### SI-04.23 — Publicar o contrato OpenAPI e os exemplos de requisição da fase

**Description:** Regenera o `openapi.json` versionado com os 14 endpoints novos ou alterados, a segurança certa em cada um e os erros pelo envelope compartilhado, e acrescenta um exemplo por endpoint ao `api.http`.

**Technical actions:**

1. Rodar `npm run openapi:export` no contêiner e conferir no `nestjs-project/openapi.json` que as rotas `@Public()` não têm `security`, as `@OptionalAuth()` têm `security` igual a `[{}, { "access-token": [] }]` e as autenticadas têm `access-token` (per `phase-04-gerenciamento/TD-02`, `openapi-docs-nestjs/TD-02`, `openapi-docs-nestjs/TD-03`)
2. Conferir que cada erro de `### Error Catalog` aparece nas operações que o lançam, referenciando `ApiErrorEnvelope`, e que `PUT /videos/{public_id}/thumbnail` declara `multipart/form-data` com o campo `file` (per `openapi-docs-nestjs/TD-01`)
3. Acrescentar a `nestjs-project/api.http` um exemplo para cada endpoint de `### API Contracts`, com host pelo nome de serviço ou variável, nunca `localhost` fixo no código

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Documento OpenAPI | E2E: as operações novas existem com a segurança de `### Authorization Matrix` (sem `access-token` nas públicas, opcional nas `@OptionalAuth()`) e os códigos de erro documentados | `test/swagger.e2e-spec.ts` |

**Dependencies:** SI-04.5, SI-04.9, SI-04.12, SI-04.16, SI-04.21, SI-04.22 — todos os endpoints existem

**Acceptance criteria:**

- Rodar `npm run openapi:export` duas vezes seguidas não produz diferença no `openapi.json`
- `openapi.json` contém as 14 operações de `### API Contracts`, e `GET /categories`, `GET /channels/{nickname}` e `GET /channels/{nickname}/videos` não têm `security`
- `GET /videos/{public_id}`, `/stream`, `/download` e `/thumbnail` têm `security` igual a `[{}, { "access-token": [] }]`
- `api.http` tem um exemplo para cada um dos 14 endpoints

---

### SI-04.24 — Atualizar a documentação e fechar a Definition of Done da fase

**Description:** Deixa os `CLAUDE.md`, o diagrama e o `progress.md` fiéis ao que a fase entrega e prova a Definition of Done técnica no contêiner.

**Technical actions:**

1. Atualizar `nestjs-project/CLAUDE.md`: módulos novos (`CategoriesModule`, `ThrottlingModule`, `VideoListingsModule`, `ChannelsController`), tabela de endpoints com o acesso de cada um (rascunho, publicado, público, `unlisted`), throttlers nomeados no lugar da nota do throttler único, a capa customizada e o `ffmpeg` em pipe na API com o equivalente de `SAFE_INPUT_OPTIONS` para imagens (per PRD 07)
2. Atualizar o `CLAUDE.md` da raiz (seção de vídeos e o que a Fase 04 acrescenta) e conferir `docs/diagrams/software-arch.mermaid` contra o código, mudando só o que o fluxo mudou (a capa customizada passa pela API)
3. Registrar no `docs/phases/phase-04-gerenciamento/progress.md` que o Painel e a Página pública do canal são entregues como API (`non-ui`: a UI não faz parte da especificação do projeto) e a origem das escolhas do dono sem bullet no plano (per `## Non-UI / Deferred Capabilities` de `context.md`)
4. Rodar no contêiner `npm test -- --runInBand`, `npm run test:e2e`, `npx tsc --noEmit` e `npm run lint`, corrigir o que falhar e registrar as saídas no `progress.md`

**Tests:** _(empty — documentação e verificação; a suíte completa é o critério)_

**Dependencies:** SI-04.23 — contrato publicado; SI-04.3 — throttlers nomeados documentados

**Acceptance criteria:**

- Todo caminho, comando, módulo e endpoint citado nos dois `CLAUDE.md` existe no código
- `nestjs-project/CLAUDE.md` não descreve mais o throttler único de 10 requisições por minuto como global
- `progress.md` registra o Painel e a Página pública como `non-ui` entregues como API, sem apontar um ciclo de frontend
- `docker compose exec nestjs-api npm test -- --runInBand`, `npm run test:e2e`, `npx tsc --noEmit` e `npm run lint` terminam com código 0

---

## Technical Specifications

### Data Model

#### Category (nova, tabela `categories`)

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, generated |
| slug | varchar(50) | not null, unique (`UQ_categories_slug`) |
| name | varchar(50) | not null |

**Relations:** `Category` has many `Video` (one-to-many, via `videos.category_id`)
**Indexes:** unique on `slug`
**Initial data:** migration de dados reversível (exceção de `.claude/rules/typeorm-migrations.md` para dados; o schema é gerado pela CLI), com os slugs `musica`, `jogos`, `educacao`, `entretenimento`, `esportes`, `noticias`, `tecnologia`, `filmes-e-animacao`, `viagens`, `culinaria`, `outros` (per `phase-04-gerenciamento/TD-03`). Nomes em português escolhidos por este plano: Música, Jogos, Educação, Entretenimento, Esportes, Notícias, Tecnologia, Filmes e Animação, Viagens, Culinária, Outros. `down` remove só essas linhas.
**Ordering:** por `name`, com `outros` por último (per `phase-04-gerenciamento/TD-03`).

#### Video (modificada, tabela `videos`)

| Field | Type | Constraints |
|-------|------|-------------|
| description | varchar(5000) | nullable |
| category_id | uuid | nullable, FK → `categories.id` |
| visibility | varchar(16) | not null, default `'public'`, check `IN ('public', 'unlisted')` (`CHK_videos_visibility`) |
| published_at | timestamp | nullable (nulo = rascunho editorial) |
| custom_thumbnail_key | varchar(1024) | nullable; sempre `{videoId}/custom.jpg` no bucket `thumbnails` |

**Constraints:** `CHK_videos_published_ready` — `published_at IS NULL OR status = 'ready'` (per `phase-04-gerenciamento/TD-01`)
**Relations:** `Video` belongs to `Category` (many-to-one, nullable)
**Indexes:**
- `IDX_videos_channel_created` em `(channel_id, created_at DESC, id DESC)` — painel (per `phase-04-gerenciamento/TD-10`)
- `IDX_videos_channel_listable` em `(channel_id, published_at DESC, id DESC) WHERE published_at IS NOT NULL AND visibility = 'public'` — listagem pública e `video_count` (per `phase-04-gerenciamento/TD-10`)

**Column ownership:** o worker escreve só `status`, `thumbnail_key` e as colunas de metadados da Fase 03; `description`, `category_id`, `visibility`, `published_at`, `custom_thumbnail_key` e `title` são escritas só pela API (per `phase-04-gerenciamento/TD-01`, `phase-04-gerenciamento/TD-06`).
**Existing rows:** a migration publica os vídeos `ready` já existentes como `unlisted` com `published_at = now()`; os demais ficam com `visibility = 'public'` e `published_at` nulo (per `phase-04-gerenciamento/TD-01`).
**Listable predicate:** `published_at IS NOT NULL AND visibility = 'public'`, definido num só lugar do `VideosRepository` e reutilizado pela página pública do canal e pelas Fases 05 e 07 (per `phase-04-gerenciamento/TD-01`).

#### Channel (sem mudança de schema)

`name` varchar(50), `nickname` varchar(50) unique e `description` text continuam como na Fase 02. As regras novas de nickname (`^[a-z0-9_]{3,50}$` e reservados) valem na edição e na geração do cadastro, não no banco (per `phase-04-gerenciamento/TD-08`, Revision de `phase-02-auth/TD-10`).

### API Contracts

Todas as respostas de erro usam o envelope `{ statusCode, error, message }` (per `phase-02-auth/TD-07`); `400 VALIDATION_ERROR` é o do `ValidationExceptionFilter` (`whitelist` + `forbidNonWhitelisted`, então campo desconhecido é `400`). `429` vem do `ThrottlerGuard`. Vídeos são endereçados só pelo `public_id` (11 caracteres); o UUID interno nunca aparece.

**Representação de vídeo (`VideoResponse`)**, usada por `GET /videos/{public_id}`, `PATCH /videos/{public_id}` e `POST /videos/{public_id}/publication` (per `phase-04-gerenciamento/TD-04`, `phase-04-gerenciamento/TD-05`):
- public_id: string
- title: string
- description: string | null
- category: `{ slug: string, name: string }` | null
- status: `draft` | `processing` | `ready` | `error`
- visibility: `public` | `unlisted`
- published_at: string (date-time) | null
- thumbnail_url: string — sempre `/videos/{public_id}/thumbnail`
- duration_seconds: number | null
- width: number | null
- height: number | null
- created_at: string (date-time)
- updated_at: string (date-time)

Sem `channel` nesta fase (per `phase-04-gerenciamento/TD-04`).

**Paginação** (as duas listagens, per `phase-04-gerenciamento/TD-09`): query `page` (inteiro ≥ 1, padrão 1) e `limit` (inteiro 1–50, padrão 20); resposta `{ items, page, limit, total, total_pages }`, onde `total_pages = ceil(total / limit)` e página além da última devolve `items: []`.

**Ordem de acesso nas leituras de vídeo** (metadados, `stream`, `download`, capa; per `phase-04-gerenciamento/TD-02`, Revision de `phase-03-videos/TD-07`): (1) vídeo inexistente, ou `published_at` nulo e o pedinte não é o dono (anônimo incluído) → `404 VIDEO_NOT_FOUND`; (2) vídeo não `ready` → `409 VIDEO_NOT_READY` (só o dono chega aqui); (3) caso contrário, serve. Essas rotas são `@OptionalAuth()`: token válido identifica o dono, token ausente, inválido ou expirado segue como anônimo, e o token só vale no cabeçalho `Authorization`. Respostas de sucesso carregam `Cache-Control: private, no-cache`.

#### GET /categories (SI-04.5)

**Response 200:**
- array de `{ slug: string, name: string }`, ordenado por `name` com `outros` por último

**Error responses:**
- 429: acima de `public-read` (300/min por IP)

---

#### GET /videos/{public_id} (SI-04.7)

**Request headers:**
- Authorization: Bearer {access_token} — opcional

**Response 200:** `VideoResponse`; cabeçalho `Cache-Control: private, no-cache`.

**Error responses:**
- 404 VIDEO_NOT_FOUND: `public_id` inexistente, ou vídeo não publicado e pedinte não é o dono
- 409 VIDEO_NOT_READY: vídeo não `ready` pedido pelo dono

---

#### GET /videos/{public_id}/stream (SI-04.8)

**Request headers:**
- Authorization: Bearer {access_token} — opcional
- Range: `bytes=start-end` — opcional, um único intervalo (inalterado da Fase 03)

**Response 200 / 206:** o arquivo (ou o intervalo), em stream; `Cache-Control: private, no-cache` (antes `no-cache`); demais cabeçalhos inalterados (`Accept-Ranges`, `Content-Range`, `Content-Length`, `ETag`).

**Error responses:**
- 404 VIDEO_NOT_FOUND / 409 VIDEO_NOT_READY: na ordem de acesso acima
- 416 INVALID_RANGE, 502 STORAGE_UNAVAILABLE: inalterados

---

#### GET /videos/{public_id}/download (SI-04.9)

**Request headers:**
- Authorization: Bearer {access_token} — opcional

**Response 200:** o arquivo como anexo, em stream; `Cache-Control: private, no-cache`; `Content-Disposition` inalterado.

**Error responses:**
- 404 VIDEO_NOT_FOUND / 409 VIDEO_NOT_READY: na ordem de acesso acima
- 502 STORAGE_UNAVAILABLE: inalterado

---

#### PATCH /videos/{public_id} (SI-04.10)

**Request headers:**
- Authorization: Bearer {access_token}
- Content-Type: application/json

**Request body** (parcial; campo omitido não muda; pelo menos um campo):
- title: string, optional — 1–100 caracteres após `trim`, texto puro
- description: string | null, optional — até 5.000 caracteres, texto puro; `null` limpa
- category: string | null, optional — `slug` de uma categoria existente; `null` limpa
- visibility: `public` | `unlisted`, optional — não altera `published_at`

**Response 200:** `VideoResponse` com os valores novos e o `updated_at` atual; edição permitida em qualquer status de processamento (per `phase-04-gerenciamento/TD-01`).

**Error responses:**
- 400 VALIDATION_ERROR: corpo vazio (`{}`), campo desconhecido ou fora das regras (per `phase-04-gerenciamento/TD-05`)
- 400 INVALID_CATEGORY: `category` com slug inexistente
- 401: sem token válido
- 403 VIDEO_ACCESS_DENIED: vídeo de outro canal
- 404 VIDEO_NOT_FOUND: `public_id` inexistente

---

#### POST /videos/{public_id}/publication (SI-04.11)

**Request headers:**
- Authorization: Bearer {access_token}
- Content-Type: application/json

**Request body:**
- visibility: `public` | `unlisted`, optional — padrão `public`

**Response 200:** `VideoResponse` publicado. Idempotente: publicar de novo grava `published_at = now()` outra vez e aplica a `visibility` do corpo (per `phase-04-gerenciamento/TD-01`). A escrita é um `UPDATE` condicional sobre `status = 'ready'`.

**Error responses:**
- 409 VIDEO_NOT_PUBLISHABLE: vídeo não está `ready`
- 400 VALIDATION_ERROR: `visibility` fora dos valores ou campo desconhecido
- 401 / 403 VIDEO_ACCESS_DENIED / 404 VIDEO_NOT_FOUND: como no `PATCH`

---

#### DELETE /videos/{public_id}/publication (SI-04.12)

**Request headers:**
- Authorization: Bearer {access_token}

**Response 204:** No content. Zera `published_at`; `visibility` é mantida. Idempotente: despublicar um rascunho também devolve `204`.

**Error responses:**
- 401 / 403 VIDEO_ACCESS_DENIED / 404 VIDEO_NOT_FOUND: como no `PATCH`

---

#### GET /videos/{public_id}/thumbnail (SI-04.14)

**Request headers:**
- Authorization: Bearer {access_token} — opcional

**Response 200:** `image/jpeg` em stream do bucket `thumbnails` — a capa customizada (`custom_thumbnail_key`) se existir, senão a gerada (`thumbnail_key`); cabeçalhos `Content-Type`, `Content-Length`, `ETag` (quando o storage devolve) e `Cache-Control: private, no-cache` (per `phase-04-gerenciamento/TD-06`).

**Error responses:**
- 404 VIDEO_NOT_FOUND / 409 VIDEO_NOT_READY: na ordem de acesso acima; `404 VIDEO_NOT_FOUND` também para vídeo `ready` sem nenhuma chave de capa
- 429: acima de `public-read`
- 502 STORAGE_UNAVAILABLE

---

#### PUT /videos/{public_id}/thumbnail (SI-04.15)

**Request headers:**
- Authorization: Bearer {access_token}
- Content-Type: multipart/form-data

**Request body:**
- file: arquivo, required — JPEG, PNG ou WebP, até 2 MiB; o conteúdo decide o formato, não a extensão nem o `Content-Type` declarados (per `phase-04-gerenciamento/TD-06`, `phase-04-gerenciamento/TD-07`)

**Response 204:** No content. A imagem é decodificada e regravada como JPEG de 640 px de largura em `thumbnails/{videoId}/custom.jpg` (sem EXIF), e `custom_thumbnail_key` é preenchida. Permitido em qualquer status de processamento.

**Error responses:**
- 413 IMAGE_TOO_LARGE: arquivo acima de 2 MiB (cortado pelo `limits.fileSize` do Multer enquanto chega)
- 415 INVALID_IMAGE: não é JPEG/PNG/WebP pelos bytes iniciais, passa do teto de pixels, é WebP animado ou o ffmpeg não decodifica
- 400 VALIDATION_ERROR: campo `file` ausente
- 401 / 403 VIDEO_ACCESS_DENIED / 404 VIDEO_NOT_FOUND
- 502 STORAGE_UNAVAILABLE

---

#### DELETE /videos/{public_id}/thumbnail (SI-04.16)

**Request headers:**
- Authorization: Bearer {access_token}

**Response 204:** No content. Remove o objeto customizado e zera `custom_thumbnail_key`; a capa gerada volta a ser servida. Idempotente.

**Error responses:**
- 401 / 403 VIDEO_ACCESS_DENIED / 404 VIDEO_NOT_FOUND
- 502 STORAGE_UNAVAILABLE

---

#### GET /channels/me/videos (SI-04.21)

**Request headers:**
- Authorization: Bearer {access_token}

**Request query parameters:**
- page: integer, optional — ≥ 1, padrão 1
- limit: integer, optional — 1–50, padrão 20

**Response 200:**
- items: array de
  - public_id: string
  - title: string
  - thumbnail_url: string
  - category: `{ slug, name }` | null
  - status: `draft` | `processing` | `ready` | `error`
  - visibility: `public` | `unlisted`
  - published_at: string (date-time) | null
  - created_at: string (date-time)
  - views: number — sempre `0` até a Fase 05
  - likes: number — sempre `0` até a Fase 06
  - comments: number — sempre `0` até a Fase 06
- page, limit, total, total_pages: number

Só o canal do usuário autenticado, todos os status, ordem `created_at DESC, id DESC`, sem filtros nem `sort` (per `phase-04-gerenciamento/TD-09`, `phase-04-gerenciamento/TD-10`).

**Error responses:**
- 400 VALIDATION_ERROR: `page` ou `limit` fora das regras
- 401: sem token válido
- 404 CHANNEL_NOT_FOUND: usuário sem canal

---

#### PATCH /channels/me (SI-04.19)

**Request headers:**
- Authorization: Bearer {access_token}
- Content-Type: application/json

**Request body** (parcial; pelo menos um campo):
- nickname: string, optional — `^[a-z0-9_]{3,50}$` e fora da lista de reservados
- name: string, optional — 1–50 caracteres após `trim`, texto puro (limite da coluna)
- description: string | null, optional — até 5.000 caracteres, texto puro; `null` limpa (limite escolhido por este plano, igual ao da descrição do vídeo)

**Response 200:**
- name: string
- nickname: string
- description: string | null
- created_at: string (date-time)

A troca de nickname muda o endereço público, sem redirecionamento; a unicidade é decidida pelo `UNIQUE` do banco (per `phase-04-gerenciamento/TD-08`).

**Error responses:**
- 400 VALIDATION_ERROR: corpo vazio, campo desconhecido, formato de nickname inválido ou texto fora das regras
- 400 NICKNAME_RESERVED: nickname na lista de reservados
- 409 NICKNAME_ALREADY_EXISTS: nickname em uso por outro canal (violação do `UNIQUE`, inclusive sob concorrência)
- 401: sem token válido
- 404 CHANNEL_NOT_FOUND: usuário sem canal

---

#### GET /channels/{nickname} (SI-04.20)

**Response 200:**
- name: string
- nickname: string
- description: string | null
- created_at: string (date-time)
- video_count: number — só vídeos listáveis

Nunca expõe `id`, `user_id` nem e-mail. Aceita qualquer nickname já gravado, mesmo curto ou legado (per `phase-04-gerenciamento/TD-08`).

**Error responses:**
- 404 CHANNEL_NOT_FOUND: nenhum canal com esse nickname
- 429: acima de `public-read`

---

#### GET /channels/{nickname}/videos (SI-04.22)

**Request query parameters:**
- page: integer, optional — ≥ 1, padrão 1
- limit: integer, optional — 1–50, padrão 20

**Response 200:**
- items: array de
  - public_id: string
  - title: string
  - thumbnail_url: string
  - duration_seconds: number | null
  - published_at: string (date-time)
- page, limit, total, total_pages: number

Só vídeos listáveis (`published_at IS NOT NULL AND visibility = 'public'`, e portanto `ready`), ordem `published_at DESC, id DESC` (per `phase-04-gerenciamento/TD-09`, `phase-04-gerenciamento/TD-10`).

**Error responses:**
- 400 VALIDATION_ERROR: `page` ou `limit` fora das regras
- 404 CHANNEL_NOT_FOUND: nenhum canal com esse nickname
- 429: acima de `public-read`

#### Validation Rules — texto puro (vídeo e canal)

- `title`, `name`: `trim` antes de validar o tamanho; vazio depois do `trim` é `400`
- `description` (vídeo e canal): quebras de linha normalizadas para `\n` (`\r\n` e `\r`); caracteres de controle rejeitados, exceto `\n` e `\t`; nunca interpretada como HTML (per `phase-04-gerenciamento/TD-04`)
- `category`: só o `slug`; slug desconhecido é `400 INVALID_CATEGORY`, não `VALIDATION_ERROR`
- `nickname`: `^[a-z0-9_]{3,50}$`, depois checagem da lista `me`, `admin`, `api`, `channels`, `videos`, `categories`, `auth`, `docs`, `support` (per `phase-04-gerenciamento/TD-08`)
- `PATCH` sem nenhum campo editável é `400 VALIDATION_ERROR` (per `phase-04-gerenciamento/TD-05`)

### Authorization Matrix

"Authenticated" é um usuário autenticado que não é o dono do vídeo ou do canal. "Rascunho" = `published_at` nulo. A coluna Throttler diz qual limite nomeado vale na rota (per `phase-04-gerenciamento/TD-11`, Revision de `phase-02-auth/TD-08`): `public-read` 300/min por IP (`THROTTLE_PUBLIC_READ_LIMIT`), `authenticated` 120/min por usuário, `uploads` 20/min por usuário, `default` 10/min por IP; cada rota ignora os throttlers que não são dela.

| Endpoint | Anonymous | Authenticated | Owner | Throttler |
|----------|-----------|---------------|-------|-----------|
| GET /categories | ✓ | ✓ | ✓ | `public-read` |
| GET /videos/{public_id} | publicado: ✓ · rascunho: 404 | publicado: ✓ · rascunho: 404 | ✓ (não `ready`: 409) | nenhum |
| GET /videos/{public_id}/stream | publicado: ✓ · rascunho: 404 | publicado: ✓ · rascunho: 404 | ✓ (não `ready`: 409) | nenhum |
| GET /videos/{public_id}/download | publicado: ✓ · rascunho: 404 | publicado: ✓ · rascunho: 404 | ✓ (não `ready`: 409) | nenhum |
| GET /videos/{public_id}/thumbnail | publicado: ✓ · rascunho: 404 | publicado: ✓ · rascunho: 404 | ✓ (não `ready`: 409) | `public-read` |
| PATCH /videos/{public_id} | ✗ 401 | ✗ 403 | ✓ | `authenticated` |
| POST /videos/{public_id}/publication | ✗ 401 | ✗ 403 | ✓ | `authenticated` |
| DELETE /videos/{public_id}/publication | ✗ 401 | ✗ 403 | ✓ | `authenticated` |
| PUT /videos/{public_id}/thumbnail | ✗ 401 | ✗ 403 | ✓ | `uploads` |
| DELETE /videos/{public_id}/thumbnail | ✗ 401 | ✗ 403 | ✓ | `uploads` |
| GET /channels/me/videos | ✗ 401 | ✓ (só o próprio canal) | ✓ | `authenticated` |
| PATCH /channels/me | ✗ 401 | ✓ (só o próprio canal) | ✓ | `authenticated` |
| GET /channels/{nickname} | ✓ | ✓ | ✓ | `public-read` |
| GET /channels/{nickname}/videos | ✓ (só listáveis) | ✓ (só listáveis) | ✓ (só listáveis) | `public-read` |
| POST /videos, GET /videos/{public_id}/upload, POST …/upload/parts, POST …/upload/completion (Fase 03) | ✗ 401 | como na Fase 03 | como na Fase 03 | `uploads` (antes `default`) |
| POST /auth/register, GET /auth/confirm-email, POST /auth/resend-confirmation, /auth/login, /auth/refresh, /auth/forgot-password, /auth/reset-password (Fase 02, `@Public()`) | como na Fase 02 | como na Fase 02 | como na Fase 02 | `default` |
| POST /auth/logout, GET /auth/me (Fase 02, autenticadas) | ✗ 401 | como na Fase 02 | como na Fase 02 | `authenticated` (antes `default`) |

As leituras de vídeo (metadados, `stream`, `download`) continuam sem throttler: um player manda uma requisição com `Range` por busca e não pode receber `429`. Nenhuma rota pública nova usa o `default`. As rotas públicas de autenticação continuam no `default` por IP (não há usuário para contar); `GET /` segue com `@SkipThrottle()`.

### Error Catalog

Formato herdado: envelope `{ statusCode, error, message }`, exceções de domínio em `src/common/exceptions/domain.exception.ts` (per `phase-02-auth/TD-07`).

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| VIDEO_NOT_PUBLISHABLE | 409 | `POST /videos/{public_id}/publication` num vídeo que não está `ready` (nova) |
| INVALID_CATEGORY | 400 | `PATCH /videos/{public_id}` com `category` de slug inexistente (nova) |
| NICKNAME_ALREADY_EXISTS | 409 | `PATCH /channels/me` com nickname já usado por outro canal, detectado pela violação do `UNIQUE` (nova) |
| NICKNAME_RESERVED | 400 | `PATCH /channels/me` com nickname da lista de reservados (nova) |
| INVALID_IMAGE | 415 | `PUT /videos/{public_id}/thumbnail` com arquivo que não é JPEG/PNG/WebP pelo conteúdo, acima do teto de pixels, WebP animado ou não decodificável (nova) |
| IMAGE_TOO_LARGE | 413 | `PUT /videos/{public_id}/thumbnail` com arquivo acima de 2 MiB (nova) |
| VIDEO_NOT_FOUND | 404 | `public_id` inexistente; vídeo em rascunho pedido por quem não é o dono (reaproveitada, gatilho ampliado) |
| VIDEO_NOT_READY | 409 | leitura de vídeo não `ready` pelo dono (reaproveitada) |
| VIDEO_ACCESS_DENIED | 403 | escrita num vídeo de outro canal (reaproveitada; a mensagem deixa de citar só o upload) |
| CHANNEL_NOT_FOUND | 404 | usuário autenticado sem canal; nickname inexistente na leitura pública (reaproveitada; a mensagem deixa de citar só o usuário autenticado) |
| VALIDATION_ERROR | 400 | corpo vazio em `PATCH`, campo desconhecido, texto fora das regras, `page`/`limit` inválidos, `file` ausente (inalterada) |

---

## Dependency Map

```
SI-04.1 (root — namespaces de config e variáveis de ambiente)
├── SI-04.3 — depende de SI-04.1 (limite `public-read` configurável)
│   └── SI-04.5 — depende de SI-04.3 + SI-04.4 (throttler `public-read` e serviço de categorias)
└── SI-04.13 — depende de SI-04.1 (teto de pixels e timeout da decodificação)
SI-04.2 (root — `@OptionalAuth()` no guard global)
└── SI-04.7 — depende de SI-04.2 + SI-04.6 (autenticação opcional e colunas de publicação)
    ├── SI-04.8 — depende de SI-04.7 (`VideoAccessService`)
    │   └── SI-04.9 — depende de SI-04.8 (download reaproveita o serviço de streaming)
    ├── SI-04.10 — depende de SI-04.3 + SI-04.7 (throttler `authenticated`, mapper e leitura com relações)
    │   ├── SI-04.11 — depende de SI-04.10 (`VideoOwnershipService`)
    │   │   └── SI-04.12 — depende de SI-04.11 (`VideoPublicationService`)
    │   └── SI-04.19 — depende de SI-04.3 + SI-04.10 + SI-04.17 (throttler, texto puro e regras de nickname)
    │       └── SI-04.20 — depende de SI-04.18 + SI-04.19 (`countListable` e `ChannelsController`)
    │           ├── SI-04.21 — depende de SI-04.18 + SI-04.20 (`listPanel` e controller com `VideoListingsModule`)
    │           └── SI-04.22 — depende de SI-04.20 (`findByNickname`)
    │               └── SI-04.23 — depende de SI-04.5 + SI-04.9 + SI-04.12 + SI-04.16 + SI-04.21 + SI-04.22 (todos os endpoints existem)
    │                   └── SI-04.24 — depende de SI-04.23 + SI-04.3 (contrato publicado e throttlers documentados)
    └── SI-04.14 — depende de SI-04.3 + SI-04.7 (throttler `public-read` e `VideoAccessService`)
        └── SI-04.15 — depende de SI-04.13 + SI-04.14 (normalizador e `VideoThumbnailsService`)
            └── SI-04.16 — depende de SI-04.15 (capa customizada gravada)
SI-04.4 (root — categorias)
└── SI-04.6 — depende de SI-04.4 (FK para `categories`)
    └── SI-04.18 — depende de SI-04.6 (colunas, índices e predicado listável)
SI-04.17 (root, independente — regras de nickname)
```

A árvore mostra cada SI sob um único pai; as dependências adicionais (mais de um pai) estão ditas em cada linha e na linha `**Dependencies:**` do próprio SI.

---

## Deliverables

- [x] SI-04.1 — Configurar os namespaces e as variáveis de ambiente de limite de requisições e da capa customizada
- [x] SI-04.2 — Implementar a autenticação opcional (`@OptionalAuth()`) no guard global
- [x] SI-04.3 — Substituir o throttler único por throttlers nomeados por classe de rota
- [x] SI-04.4 — Criar a tabela de categorias, a lista inicial e o CategoriesModule
- [x] SI-04.5 — Endpoint GET /categories
- [x] SI-04.6 — Acrescentar ao vídeo as colunas de edição, publicação, categoria e capa customizada
- [x] SI-04.7 — Endpoint GET /videos/{public_id} (acesso por publicação e contrato ampliado)
- [x] SI-04.8 — Endpoint GET /videos/{public_id}/stream (acesso por publicação)
- [x] SI-04.9 — Endpoint GET /videos/{public_id}/download (acesso por publicação)
- [x] SI-04.10 — Endpoint PATCH /videos/{public_id}
- [x] SI-04.11 — Endpoint POST /videos/{public_id}/publication
- [x] SI-04.12 — Endpoint DELETE /videos/{public_id}/publication
- [x] SI-04.13 — Implementar o normalizador de imagem da capa com ffmpeg em pipe
- [x] SI-04.14 — Endpoint GET /videos/{public_id}/thumbnail
- [x] SI-04.15 — Endpoint PUT /videos/{public_id}/thumbnail
- [x] SI-04.16 — Endpoint DELETE /videos/{public_id}/thumbnail
- [x] SI-04.17 — Aplicar as regras de nickname na validação e na geração do cadastro
- [x] SI-04.18 — Implementar o VideoListingsModule com as consultas do painel, da página pública e do `video_count`
- [x] SI-04.19 — Endpoint PATCH /channels/me
- [x] SI-04.20 — Endpoint GET /channels/{nickname}
- [x] SI-04.21 — Endpoint GET /channels/me/videos (painel)
- [x] SI-04.22 — Endpoint GET /channels/{nickname}/videos
- [x] SI-04.23 — Publicar o contrato OpenAPI e os exemplos de requisição da fase
- [x] SI-04.24 — Atualizar a documentação e fechar a Definition of Done da fase

**Full test suites:**

- [x] Backend tests pass (`cd nestjs-project && docker compose exec nestjs-api npm test -- --runInBand`)
- [x] E2E tests pass (`cd nestjs-project && docker compose exec nestjs-api npm run test:e2e`)
- [x] Type/compilation checks pass (`cd nestjs-project && docker compose exec nestjs-api npx tsc --noEmit`)
- [x] Lint passes (`cd nestjs-project && docker compose exec nestjs-api npm run lint`)
