# PRD: Decisões prévias da Fase 04 (grilling)

## Objetivo
Registrar as decisões de produto e de contrato já tomadas pelo dono do projeto antes do `/research`, para que a pesquisa as **justifique e detalhe** (opções, trade-offs, bibliotecas) em vez de reabri-las.

## Contexto
- Origem: sessão de grilling sobre os PRDs 01 a 07 da Fase 04 (quatro rodadas) e conferência das decisões contra o `project-plan.md`, o `CLAUDE.md` e as regras de `.claude/rules/`. Escopo: **só backend (NestJS)**; painel e página pública do frontend ficam para outro ciclo (`phase-04-gerenciamento-frontend`).
- **Rastreabilidade:** cada decisão vem do **plano** (bullet literal da Fase 04) ou é **escolha do dono (grilling)**. As escolhas do dono estão marcadas com _(dono)_; o documento de decisões da fase deve repetir essa marca, e cada `Capability:` deve citar um bullet do plano.
- Herda decisões da Fase 03 (`docs/decisions/technical-decisions-phase-03-videos.md`): TD-06 (`public_id` é o único identificador público), TD-07 (streaming e download pela API), TD-08 (publicação e visibilidade em colunas **separadas** do status de processamento) e TD-09 (dois buckets no MinIO).
- Fatos do código que sustentam as decisões: o `JwtAuthGuard` global devolve `true` em rota `@Public()` sem ler o token; o frontend é BFF estrito (o navegador só fala com `/api/...` do Next, que injeta o `Authorization` a partir do cookie de sessão); o `ThrottlerGuard` global limita a 10 requisições por minuto por IP; os nicknames hoje nascem só com `[a-z0-9_]`.

## Decisões
### Publicação, visibilidade e acesso
1. **Modelo.** Duas colunas: `visibility` (`public` | `unlisted`) e `published_at` (nulo = rascunho). `CHECK`: só vídeo `ready` tem `published_at`. Não altera o status de processamento nem o compare-and-set do worker.
2. **Vídeos existentes.** A migration publica os vídeos `ready` já existentes como `unlisted` (`published_at = now()`); os demais ficam em rascunho.
3. **Endpoints.** _(plano: fluxo rascunho → publicação; dono: despublicar)_ `POST /videos/{public_id}/publication` publica e `DELETE` despublica (ambos idempotentes); `visibility` muda pelo `PATCH /videos/{public_id}`. Publicar vídeo que não está `ready` → `409 VIDEO_NOT_PUBLISHABLE`. Ao publicar, `public` é o padrão, com `visibility` opcional no corpo. Cada publicação grava `published_at = now()` e despublicar zera para nulo; mudar entre `public` e `unlisted` com o vídeo já publicado **não** altera o `published_at` (decisão 21).
4. **Edição.** Permitida em qualquer status de processamento; a edição só escreve colunas que o worker não escreve.
5. **Não-dono e ordem de checagem.** Vídeo em rascunho pedido por quem não é o dono (inclusive anônimo) retorna `404 VIDEO_NOT_FOUND` em metadados, `stream`, `download` e capa. Como o `CHECK` da decisão 1 faz todo vídeo não `ready` ser rascunho, a ordem é: (1) rascunho e pedinte que não é o dono → `404`; (2) só então vídeo não `ready` → `409 VIDEO_NOT_READY`, que na prática só o dono vê.
6. **Autenticação opcional.** Novo `@OptionalAuth()` no guard global: token válido preenche o usuário; ausente, inválido ou expirado segue como anônimo. O token só vale no cabeçalho `Authorization` (nada de `?token=` nem cookie na API).
7. **Cache.** `Cache-Control: private, no-cache` em metadados, `stream`, `download` e capa.

### Categorias, edição e capa
8. **Categorias.** Tabela `categories` (UUID + `slug` único); `category_id` nulo em `videos`; lista inicial inserida por migration de dados reversível; o cliente usa o `slug`. Lista: `musica`, `jogos`, `educacao`, `entretenimento`, `esportes`, `noticias`, `tecnologia`, `filmes-e-animacao`, `viagens`, `culinaria` e `outros`, em ordem alfabética por nome com `outros` por último.
9. **Texto.** Título de 1 a 100 caracteres após `trim`; descrição opcional de até 5.000. Texto puro: rejeita caracteres de controle (exceto quebra de linha e tab), normaliza quebras de linha, nunca devolve HTML.
10. **Contrato de leitura.** `GET /videos/{public_id}` ganha `description`, `category` (`{ slug, name }` ou nulo), `visibility`, `published_at` e `thumbnail_url` (`/videos/{public_id}/thumbnail`). O `PATCH` é parcial (`title`, `description`, `category` por `slug` com `null` limpando, `visibility`); campo omitido não muda; campo desconhecido é `400`. Vídeo ainda não `ready` responde `409 VIDEO_NOT_READY` ao dono, na ordem da decisão 5; o painel é quem mostra esses. Não entra `channel` na resposta nesta fase (decisão 22).
11. **Capa customizada.** Enviada pela **API** (multipart, até 2 MiB), com o conteúdo validado antes de gravar. Duas chaves: `thumbnail_key` (gerada pelo worker) e `custom_thumbnail_key` (`{videoId}/custom.jpg`). Aceita JPEG, PNG ou WebP; decodifica para validar e regrava como JPEG de 640 px de largura com o ffmpeg (remove EXIF). `GET`, `PUT` e `DELETE /videos/{public_id}/thumbnail`: `GET` devolve a customizada se existir, senão a gerada, com as regras de acesso do vídeo; `PUT` e `DELETE` são do dono. O worker nunca toca na customizada.

### Painel e canal
12. **Rotas.** `GET /channels/me/videos` (painel, autenticado), `PATCH /channels/me`, `GET /channels/{nickname}` e `GET /channels/{nickname}/videos` (públicas), `GET /categories` (pública).
13. **Painel.** _(plano: campos do painel; dono: valores `0`)_ Devolve `views`, `likes` e `comments` com valor `0` fixo, documentado como placeholder até as Fases 05 e 06. Só o canal do usuário autenticado (não há parâmetro de canal).
14. **Paginação.** `page` + `limit` (padrão 20, máximo 50) com `total` e `total_pages`; ordem mais recente primeiro (`published_at` na pública, `created_at` no painel), com desempate por id. Mesmo formato nas duas listagens. O painel **não** tem filtros nem `sort` nesta fase: cada item já traz `status`, `visibility` e `published_at` (o filtro fica para um ciclo futuro).
15. **Nickname.** Editável; o endereço público é `/channels/{nickname}` e a troca muda o endereço, sem redirecionamento. Formato `^[a-z0-9_]{3,50}$` e reservados (`me`, `admin`, `api`, `channels`, `videos`, `categories`, `auth`, `docs`, `support`), validados na edição; a unicidade é decidida pelo `UNIQUE` do banco. A geração do nickname no cadastro também evita os reservados (cai no sufixo aleatório existente) e as rotas públicas aceitam qualquer nickname já gravado, mesmo curto ou legado.
16. **Canal público.** _(dono: `video_count` e `duration_seconds`)_ Expõe `name`, `nickname`, `description`, `created_at` e `video_count` (só publicados e públicos); item da lista: `public_id`, `title`, `thumbnail_url`, `duration_seconds`, `published_at`. Nenhum `id`, `user_id` nem e-mail.

### Transversais
17. **Rate limit (mecanismo).** Throttlers nomeados: `public-read` (por IP) nas rotas públicas novas (categorias, capa, canal público e sua listagem) e `authenticated` (por usuário) nas autenticadas. Como todos os throttlers registrados valem globalmente, cada rota **ignora** os que não são dela (`skipIf` ou `@SkipThrottle` por nome).
18. **Erros novos** _(dono)_ (envelope `{ statusCode, error, message }`): `VIDEO_NOT_PUBLISHABLE` (409), `INVALID_CATEGORY` (400), `NICKNAME_ALREADY_EXISTS` (409), `NICKNAME_RESERVED` (400), `INVALID_IMAGE` (415), `IMAGE_TOO_LARGE` (413). Reaproveita `VIDEO_NOT_FOUND`, `CHANNEL_NOT_FOUND` e `VIDEO_NOT_READY`.
19. **Limite das rotas autenticadas** _(dono)_. Throttler `authenticated`, contado **por usuário** (`sub` do JWT; possível porque o `JwtAuthGuard` é registrado antes do `ThrottlerGuard`): 120 por minuto nas leituras e escritas comuns (`PATCH`, publicar, painel). Upload da Fase 03 e capa ficam num grupo mais restrito, 20 por minuto por usuário. Login, cadastro e reset seguem em 10 por minuto por IP.
20. **Limite `public-read`** _(dono)_. 300 por minuto por IP, configurável por `THROTTLE_PUBLIC_READ_LIMIT`.
21. **`published_at` ao republicar** _(dono)_. Ver decisão 3: publicar grava `now()`, despublicar zera, trocar a visibilidade não mexe.
22. **Dono do vídeo na leitura** _(dono)_. Sem `channel: { name, nickname }` em `GET /videos/{public_id}` nesta fase; vira requisito da Fase 05 (acrescentar campo é compatível).
23. **Vídeo listável** _(dono)_. Predicado único `published_at IS NOT NULL AND visibility = 'public'`, definido num só lugar do repositório de vídeos e reutilizado pela página pública do canal e pelas Fases 05 (sugestões) e 07 (grade, busca, filtro). `unlisted` publicado só é acessível por link direto, como o plano pede para a Fase 05.
24. **Documentação OpenAPI de autenticação opcional** _(dono)_. Rotas com `@OptionalAuth()` declaram segurança **opcional** (sem token ou `access-token`), porque o token do dono muda a resposta. A regra `nestjs-controllers.md` (que proíbe `@ApiBearerAuth` em `@Public()`) ganha essa exceção.
25. **Camadas** _(dono)_. As listagens `/channels/me/videos` e `/channels/{nickname}/videos` consultam `Video`: a consulta e o serviço ficam no módulo de vídeos e o controller só declara a rota sob `/channels`. O `ChannelsService` não consulta `Video`; ele só resolve o canal.

### Origem das escolhas sem bullet no plano _(dono)_
Despublicar (`DELETE .../publication`), remover a capa (`DELETE .../thumbnail`), `video_count` e `duration_seconds`, os limites (2 MiB, 640 px, 5.000 caracteres, `page`/`limit` 20 e 50, 120/20/300 por minuto), a lista de nicknames reservados e a lista inicial de categorias. O documento de decisões da fase e o `progress.md` devem citar essa origem.

## Fora de escopo
- **Frontend da fase** (painel do canal e página pública do canal no Next.js): o plano os inclui na Fase 04, mas esta fase entrega só a API. Fica para o ciclo `phase-04-gerenciamento-frontend`, e o `progress.md` deve registrá-lo como pendência, não como esquecimento.
- Painel: as contagens `views`, `likes` e `comments` são `0` fixo até as Fases 05 e 06.
- Reabrir qualquer decisão acima na pesquisa; o `/research` pode discordar de uma delas **só** apontando um fato do código ou da biblioteca que a torne inviável, e a discordância vai para o dono decidir.

## Critérios de aceite
- Cada decisão aparece no documento de decisões da fase (`Decision:` coerente com este PRD) ou tem a discordância registrada.
- Os PRDs 01 a 07 e o plano são coerentes com estas decisões.
- O documento de decisões substitui explicitamente, como **Revision**, a TD-07 da Fase 03 (leitura de qualquer `ready` por quem tiver o link), a Authorization Matrix e o `Cache-Control: no-cache`.
