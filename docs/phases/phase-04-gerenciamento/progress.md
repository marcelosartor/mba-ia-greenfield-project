# phase-04-gerenciamento — Progress

**Status:** completed
**SIs:** 24/24 completed

### SI-04.1 — Configurar os namespaces e as variáveis de ambiente de limite de requisições e da capa customizada
- **Status:** completed
- **Tests:** 23 passing (4 suites)
- **Observations:**
  - Os testes de `videoConfig` saíram de `src/config/redis.config.spec.ts` para `src/config/video.config.spec.ts` (o arquivo que o plano lista), para não duplicar a checagem do objeto inteiro.
  - Os testes rodaram direto no contêiner com a saída cortada, sem subagente: a saída é curta e cabe no contexto.

### SI-04.2 — Implementar a autenticação opcional (`@OptionalAuth()`) no guard global
- **Status:** completed
- **Tests:** 13 passing (2 suites)
- **Observations:**
  - A segurança opcional do OpenAPI usa `ApiSecurity({})` + `ApiBearerAuth('access-token')`, conferido no código instalado de `@nestjs/swagger` 11.4.2.
  - O guard foi reorganizado com um `verify()` privado compartilhado pela rota protegida e pela opcional; o comportamento das rotas protegidas não mudou (testes existentes seguem passando).

### SI-04.3 — Substituir o throttler único por throttlers nomeados por classe de rota
- **Status:** completed
- **Tests:** 21 passing (11 unit + 10 e2e, 4 suites)
- **Observations:**
  - O `ThrottlerModule` saiu de `AuthModule` para `src/throttling/throttling.module.ts`; os dois `APP_GUARD` ficaram em `AuthModule` na ordem `JwtAuthGuard` → `ThrottlerGuard`.
  - Cada throttler usa `skipIf` lendo o metadado de classe de rota; `@SkipThrottle()` sem argumento só pula o `default`, e as rotas sem classe já são ignoradas pelos outros três, então as leituras de vídeo continuam sem nenhum limite.
  - O contador padrão do `@nestjs/throttler` 6.5 é por rota, por throttler e por tracker: 20 chamadas de upload valem por rota, não somadas entre as quatro rotas de upload.
  - `test/videos-public-throttle.e2e-spec.ts` foi ajustado: o controle de `POST /videos` agora espera o `429` na 21ª chamada (throttler `uploads`), não na 11ª.
  - O limite configurável de `public-read` é provado em `test/throttling.e2e-spec.ts` por um controller de teste marcado com `@PublicReadThrottle()`, porque nenhuma rota pública da fase existe ainda neste ponto do plano.

### SI-04.4 — Criar a tabela de categorias, a lista inicial e o CategoriesModule
- **Status:** completed
- **Tests:** 12 passing (5 suites)
- **Observations:**
  - Migrations: `1790521611777-CreateCategories` (gerada pela CLI) e `1790521625754-SeedCategories` (criada pela CLI e escrita à mão; `down` remove só os 11 slugs).
  - Criado `src/test/all-migrations.ts` com a lista ordenada de todas as migrations e `undoMigrationsThrough()`, que desfaz a partir do topo lendo a tabela `migrations`; `src/database/migrations.integration-spec.ts` passou a usá-los para continuar verde com as migrations novas (antes ele desfazia a "última" assumindo que era a da Fase 03).
  - A ordem "por nome, `outros` por último" usa `CASE` no `ORDER BY` e a collation do banco para os acentos (Culinária, Educação…).

### SI-04.5 — Endpoint GET /categories
- **Status:** completed
- **Tests:** 2 passing (e2e `test/categories-list.e2e-spec.ts`)
- **Observations:** none

### SI-04.6 — Acrescentar ao vídeo as colunas de edição, publicação, categoria e capa customizada
- **Status:** completed
- **Tests:** 51 passing (5 suites) + 107 do worker como regressão
- **Observations:**
  - Migration `1790521828575-AddVideoManagementColumns` gerada pela CLI, com o passo de dados escrito à mão (vídeos `ready` existentes viram `unlisted` com `published_at = now()`) antes dos índices e das restrições.
  - Os índices `IDX_videos_channel_created` e `IDX_videos_channel_listable` saíram em ordem ascendente: o `@Index` do TypeORM não aceita `DESC` por coluna. O Postgres percorre o btree nos dois sentidos, então `ORDER BY … DESC, id DESC` usa o mesmo índice (a conferir com `EXPLAIN` na SI-04.18).
  - A relação `Video → Category` exige a entidade `Category` em todo DataSource que carrega `Video`: `VideosRepositoryModule` registra `[Video, Category]` (API e worker), e os 17 specs com a constante `ALL_ENTITIES` ganharam `Category`.
  - O spec de migrations de categorias foi movido de `src/database/migrations/` para `src/database/`: o glob `migrations/*.ts` do `data-source.ts` carregava o spec como migration e quebrava o `migration:generate`. Pelo mesmo motivo o spec desta SI ficou em `src/database/video-management.migration.integration-spec.ts`, não em `migrations/` como o plano indicava.
  - Duas fixtures de `videoConfig` (`video-uploads.service.spec.ts` e `video.processor.spec.ts`) ganharam os campos da SI-04.1 que o `tsc` apontou.

### SI-04.7 — Endpoint GET /videos/{public_id} (acesso por publicação e contrato ampliado)
- **Status:** completed
- **Tests:** 22 passing (17 unit/integration + 5 e2e)
- **Observations:**
  - A regra de acesso saiu de `VideosService.getReadyVideo` para `VideoAccessService.loadReadable`; `VideosService.getVideo` só delega e mapeia. O antigo `src/videos/videos.service.spec.ts` (que testava a regra "só `ready`") foi removido e substituído por `video-access.service.spec.ts`; a SI-04.10 recria o `videos.service.spec.ts` com os testes de edição.
  - `videos.service.integration-spec.ts` foi adaptado à regra nova (publicado, rascunho só para o dono carregado via `channel`).
  - `Cache-Control: private, no-cache` via `@Header` no handler (vale só para a resposta de sucesso; erros passam pelo filtro).

### SI-04.8 — Endpoint GET /videos/{public_id}/stream (acesso por publicação)
- **Status:** completed
- **Tests:** 9 e2e + unit/integration do stream passando
- **Observations:**
  - Assinatura `stream(publicId, range, viewerUserId?)`: o pedinte vai por último e, ausente, a leitura é anônima (o padrão mais restrito), evitando reordenar as chamadas dos testes existentes.
  - O unit spec monta o serviço com o `VideoAccessService` real sobre o repositório mockado, então os testes de ramo antigos continuam valendo; os specs de integração passaram a semear `published_at`.
  - O e2e manteve três regressões da Fase 03 que o spec reescrito não listava (busca em ponto arbitrário, `Range` com mais de um intervalo, fechamento do stream do storage quando o cliente sai); elas foram acrescentadas a `specs/videos-stream.plan.md` como cenários `Source: manual` (1.7 a 1.9).
  - Os testes de download do mesmo unit spec ficaram vermelhos até a SI-04.9 (o download ainda usava `findByPublicId`).

### SI-04.9 — Endpoint GET /videos/{public_id}/download (acesso por publicação)
- **Status:** completed
- **Tests:** 33 unit/integration + 5 e2e passando
- **Observations:**
  - `loadReadyVideo` e a dependência de `VideosRepository` saíram do `VideoStreamingService`; o acesso das duas leituras passa pelo `VideoAccessService`.
  - O import de `@Public()` ficou sem uso em `videos.controller.ts` (nenhuma rota de vídeo é `@Public()` agora) e foi removido.
  - O e2e de download manteve o cenário de nome de arquivo do anexo (regressão da Fase 03), que já estava no spec como `Source: manual`.

### SI-04.10 — Endpoint PATCH /videos/{public_id}
- **Status:** completed
- **Tests:** 90 unit/integration (inclui regressão do upload) + 7 e2e passando
- **Observations:**
  - `VideoOwnershipService.loadOwned` manteve o mecanismo da Fase 03 (`findByPublicId` + `ChannelsService.findByUserId`), para os mocks do spec de upload continuarem valendo; o `VideoUploadsService` passou a recebê-lo e perdeu `assertOwner`/`loadOwnedVideo`.
  - A mensagem de `VIDEO_ACCESS_DENIED` mudou para "Only the owner of the video can manage it".
  - Corpo vazio no `PATCH` vira `BadRequestException` no service, que o `ValidationExceptionFilter` entrega como `400 VALIDATION_ERROR`.

### SI-04.11 — Endpoint POST /videos/{public_id}/publication
- **Status:** completed
- **Tests:** 7 unit/integration + 6 e2e passando
- **Observations:**
  - `VideoPublicationService` recebeu `publish` e `unpublish` juntos (os dois são da mesma classe); os testes de `unpublish` estão no mesmo unit spec, que o plano atribui às SI-04.11 e 04.12.

### SI-04.12 — Endpoint DELETE /videos/{public_id}/publication
- **Status:** completed
- **Tests:** 5 unit + 3 e2e passando
- **Observations:** none

### SI-04.13 — Implementar o normalizador de imagem da capa com ffmpeg em pipe
- **Status:** completed
- **Tests:** 18 passing (unit + integração com ffmpeg real)
- **Observations:**
  - A linha de comando foi validada no contêiner antes de escrever o serviço (`jpeg_pipe`/`png_pipe`/`webp_pipe` em stdin, JPEG em `-f image2 pipe:1`; texto no stdin sai com código 1).
  - O equivalente de `SAFE_INPUT_OPTIONS` para imagens é demuxer forçado pelo conteúdo + `-protocol_whitelist pipe`; `-max_alloc` de 128 MiB e saída limitada a 8 MiB (escolhas do plano/implementação).
  - O teste "sem chamar o ffmpeg" usa `jest.mock('node:child_process')` envolvendo o `spawn` real, para contar as chamadas sem trocar o comportamento.

### SI-04.14 — Endpoint GET /videos/{public_id}/thumbnail
- **Status:** completed
- **Tests:** 5 unit/integration + 4 e2e passando
- **Observations:**
  - Criado `src/test/image-fixtures.ts` (`generateImage`, imagens reais pelo ffmpeg do contêiner) para os testes de capa das SI-04.14 a 04.16.
  - `PRIVATE_NO_CACHE` é exportado de `video-streaming.service.ts` e reaproveitado pela capa.

### SI-04.15 — Endpoint PUT /videos/{public_id}/thumbnail
- **Status:** completed
- **Tests:** 9 unit/integration + 6 do worker + 6 e2e passando
- **Observations:**
  - O estouro do `limits.fileSize` do Multer vira `PayloadTooLargeException` no `@nestjs/platform-express`; o filtro `ImageTooLargeFilter` (só nesta rota) a converte em `IMAGE_TOO_LARGE` no envelope do projeto, reaproveitando o `DomainExceptionFilter`.
  - Arquivo ausente usa `ParseFilePipe({ fileIsRequired: true })`, que lança `BadRequestException` e sai como `VALIDATION_ERROR`.
  - `@types/multer` não está instalado; o controller usa uma interface local mínima (`UploadedImage { buffer }`) em vez de adicionar a dependência.
  - A constante `PRIVATE_NO_CACHE`, que estava duplicada no controller, passou a vir de `video-streaming.service.ts`.

### SI-04.16 — Endpoint DELETE /videos/{public_id}/thumbnail
- **Status:** completed
- **Tests:** 15 unit/integration + 3 e2e passando
- **Observations:**
  - `removeCustom` zera a coluna antes de apagar o objeto: uma falha no storage nunca deixa o vídeo apontando para um objeto inexistente (no máximo sobra um objeto órfão).

### SI-04.17 — Aplicar as regras de nickname na validação e na geração do cadastro
- **Status:** completed
- **Tests:** 48 passing (src/channels)
- **Observations:**
  - As ACs de cadastro (`POST /auth/register` com `admin@…`, `jo@…`, `maria@…`) ficam provadas no nível de `createChannel` (integração), que é o que o cadastro chama; o plano não pediu e2e para esta SI.

### SI-04.18 — Implementar o VideoListingsModule com as consultas do painel, da página pública e do `video_count`
- **Status:** completed
- **Tests:** 41 passing (3 suites)
- **Observations:**
  - As páginas usam `offset`/`limit` em vez de `skip`/`take`: com join o TypeORM faria uma consulta extra de ids; como o join é many-to-one (não multiplica linhas), `offset`/`limit` é seguro e mantém uma SELECT de itens mais uma COUNT (provado contando as consultas do `PostgresQueryRunner`).
  - O `EXPLAIN` roda com `SET LOCAL enable_seqscan = off`, porque com poucas linhas o planner prefere seq scan; o teste prova que o índice parcial atende `ORDER BY published_at DESC, id DESC` apesar de criado em ordem ascendente (ver SI-04.6).

### SI-04.19 — Endpoint PATCH /channels/me
- **Status:** completed
- **Tests:** 54 unit/integration (src/channels) + 6 e2e passando
- **Observations:**
  - `updateOwn` usa `update` direto (sem checar existência antes): a unicidade fica com o `UNIQUE`, e a violação vira `NICKNAME_ALREADY_EXISTS` pelo `isPgUniqueViolationOnColumn` que já existia; o teste de integração dispara duas trocas simultâneas e confirma um vencedor.
  - O nickname reservado é checado antes de qualquer consulta ao banco.

### SI-04.20 — Endpoint GET /channels/{nickname}
- **Status:** completed
- **Tests:** 8 integration + 5 e2e passando; 80 de src/auth como regressão
- **Observations:**
  - `ChannelsModule` passou a importar `VideoListingsModule` (que só importa `VideosRepositoryModule`, sem ciclo); o controller compõe `ChannelsService.findByNickname` + `VideoListingsService.countListable`, e o `ChannelsService` continua sem consultar `Video`.
  - A mensagem de `CHANNEL_NOT_FOUND` mudou para "Channel not found".
  - Regressão da SI-04.3 corrigida aqui: `src/auth/auth.module.spec.ts` não carregava `throttleConfig`, que o `ThrottlingModule` injeta; na SI-04.3 só rodei os testes da própria SI.

### SI-04.21 — Endpoint GET /channels/me/videos (painel)
- **Status:** completed
- **Tests:** 6 e2e passando
- **Observations:**
  - O handler resolve o canal com `findByUserId` e lança `ChannelNotFoundException` quando é nulo (checagem de nulo no controller, permitida pela regra de camadas).

### SI-04.22 — Endpoint GET /channels/{nickname}/videos
- **Status:** completed
- **Tests:** 5 e2e passando (22 nos quatro e2e de canal)
- **Observations:** none

### SI-04.23 — Publicar o contrato OpenAPI e os exemplos de requisição da fase
- **Status:** completed
- **Tests:** 7 e2e (swagger) passando; openapi:export idempotente (cmp sem diferença)
- **Observations:**
  - As 14 operações estão no `openapi.json`: públicas sem `security`, as quatro `@OptionalAuth()` com `[{}, { "access-token": [] }]`, as autenticadas com `access-token`; `PUT …/thumbnail` declara `multipart/form-data` com `file`.
  - `api.http` ganhou os exemplos 18 a 28 e os títulos dos 15 a 17 passaram a descrever a regra de acesso por publicação. O arquivo continua com `@baseUrl = http://localhost:3000`, que é para o REST client da máquina host (como já estava); nada no código da API usa `localhost`.

### SI-04.24 — Atualizar a documentação e fechar a Definition of Done da fase
- **Status:** completed
- **Tests:** suíte completa: 80 suítes / 663 testes (unit + integração) e 23 suítes / 162 testes (e2e), todos passando; tsc e lint com código 0
- **Observations:**
  - **Escopo:** o Painel de gerenciamento e a Página pública do canal são entregues como API (`non-ui`): a UI não faz parte da especificação do projeto (decisão do dono, 2026-09-27, registrada em `## Non-UI / Deferred Capabilities` do `context.md`). Não há ciclo de frontend pendente para esta fase.
  - **Origem das escolhas do dono sem bullet no plano (PRD 00):** despublicar (`DELETE …/publication`), remover a capa (`DELETE …/thumbnail`), `video_count` e `duration_seconds`, os limites (2 MiB, 640 px, 5.000 caracteres, `page`/`limit` 20 e 50, 120/20/300 por minuto), a lista de nicknames reservados e a lista inicial de categorias. Escolhas do plano: nomes de exibição das categorias, timeout de 5 s e `-max_alloc` de 128 MiB na capa, limites do canal (nome 1–50, descrição até 5.000).
  - **DoD (no contêiner):** `npm test -- --runInBand` → 80/80 suítes, 663/663 testes; `npm run test:e2e` → 23/23 suítes, 162/162 testes; `npx tsc --noEmit` → código 0; `npm run lint` → código 0 (0 erros, 23 avisos `no-unsafe-argument` em `src/auth/auth.service*.spec.ts`, linhas que esta fase não alterou).
  - Correções da verificação final: `src/openapi-export.integration-spec.ts` (Fase 03) esperava as leituras de vídeo sem segurança e passou a esperar a segurança opcional; o teste do `EXPLAIN` também desliga `enable_sort`, porque na suíte completa as estatísticas faziam o planner preferir outro índice + ordenação.
  - `docs/diagrams/software-arch.mermaid`: a API passa a ser "Nest.js + FFmpeg" e a relação API → Object Storage inclui servir capas e gravar as customizadas. O diagrama mantém o container de Frontend, que já existia e não foi mexido.
