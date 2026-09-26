# PRD: Decisões prévias da Fase 04 (grilling)

## Objetivo
Registrar as decisões de produto e de contrato já tomadas pelo dono do projeto antes do `/research`, para que a pesquisa as **justifique e detalhe** (opções, trade-offs, bibliotecas) em vez de reabri-las.

## Contexto
- Origem: sessão de grilling sobre os PRDs 01 a 07 da Fase 04 (22 questões, três rodadas). Escopo: **só backend (NestJS)**; painel e página pública do frontend ficam para outro ciclo.
- Herda decisões da Fase 03 (`docs/decisions/technical-decisions-phase-03-videos.md`): TD-06 (`public_id` é o único identificador público), TD-07 (streaming e download pela API), TD-08 (publicação e visibilidade em colunas **separadas** do status de processamento) e TD-09 (dois buckets no MinIO).
- Fatos do código que sustentam as decisões: o `JwtAuthGuard` global devolve `true` em rota `@Public()` sem ler o token; o frontend é BFF estrito (o navegador só fala com `/api/...` do Next, que injeta o `Authorization` a partir do cookie de sessão); o `ThrottlerGuard` global limita a 10 requisições por minuto por IP; os nicknames hoje nascem só com `[a-z0-9_]`.

## Decisões
### Publicação, visibilidade e acesso
1. **Modelo.** Duas colunas: `visibility` (`public` | `unlisted`) e `published_at` (nulo = rascunho). `CHECK`: só vídeo `ready` tem `published_at`. Não altera o status de processamento nem o compare-and-set do worker.
2. **Vídeos existentes.** A migration publica os vídeos `ready` já existentes como `unlisted` (`published_at = now()`); os demais ficam em rascunho.
3. **Endpoints.** `POST /videos/{public_id}/publication` publica e `DELETE` despublica (ambos idempotentes); `visibility` muda pelo `PATCH /videos/{public_id}`. Publicar vídeo que não está `ready` → `409 VIDEO_NOT_PUBLISHABLE`. Ao publicar, `public` é o padrão, com `visibility` opcional no corpo.
4. **Edição.** Permitida em qualquer status de processamento; a edição só escreve colunas que o worker não escreve.
5. **Não-dono.** Pedir metadados, `stream`, `download` ou capa de um vídeo em rascunho retorna `404 VIDEO_NOT_FOUND`.
6. **Autenticação opcional.** Novo `@OptionalAuth()` no guard global: token válido preenche o usuário; ausente, inválido ou expirado segue como anônimo. O token só vale no cabeçalho `Authorization` (nada de `?token=` nem cookie na API).
7. **Cache.** `Cache-Control: private, no-cache` em metadados, `stream`, `download` e capa.

### Categorias, edição e capa
8. **Categorias.** Tabela `categories` (UUID + `slug` único); `category_id` nulo em `videos`; lista inicial inserida por migration de dados reversível; o cliente usa o `slug`. Lista: `musica`, `jogos`, `educacao`, `entretenimento`, `esportes`, `noticias`, `tecnologia`, `filmes-e-animacao`, `viagens`, `culinaria` e `outros`, em ordem alfabética por nome com `outros` por último.
9. **Texto.** Título de 1 a 100 caracteres após `trim`; descrição opcional de até 5.000. Texto puro: rejeita caracteres de controle (exceto quebra de linha e tab), normaliza quebras de linha, nunca devolve HTML.
10. **Contrato de leitura.** `GET /videos/{public_id}` ganha `description`, `category` (`{ slug, name }` ou nulo), `visibility`, `published_at` e `thumbnail_url` (`/videos/{public_id}/thumbnail`). O `PATCH` é parcial (`title`, `description`, `category` por `slug` com `null` limpando, `visibility`); campo omitido não muda; campo desconhecido é `400`. Vídeo ainda não `ready` continua `409 VIDEO_NOT_READY` até para o dono; o painel é quem mostra esses.
11. **Capa customizada.** Enviada pela **API** (multipart, até 2 MiB), com o conteúdo validado antes de gravar. Duas chaves: `thumbnail_key` (gerada pelo worker) e `custom_thumbnail_key` (`{videoId}/custom.jpg`). Aceita JPEG, PNG ou WebP; decodifica para validar e regrava como JPEG de 640 px de largura com o ffmpeg (remove EXIF). `GET`, `PUT` e `DELETE /videos/{public_id}/thumbnail`: `GET` devolve a customizada se existir, senão a gerada, com as regras de acesso do vídeo; `PUT` e `DELETE` são do dono. O worker nunca toca na customizada.

### Painel e canal
12. **Rotas.** `GET /channels/me/videos` (painel, autenticado), `PATCH /channels/me`, `GET /channels/{nickname}` e `GET /channels/{nickname}/videos` (públicas), `GET /categories` (pública).
13. **Painel.** Devolve `views`, `likes` e `comments` com valor `0` fixo, documentado como placeholder até as Fases 05 e 06. Só o canal do usuário autenticado (não há parâmetro de canal).
14. **Paginação.** `page` + `limit` (padrão 20, máximo 50) com `total` e `total_pages`; ordem mais recente primeiro (`published_at` na pública, `created_at` no painel), com desempate por id. Mesmo formato nas duas listagens.
15. **Nickname.** Editável; o endereço público é `/channels/{nickname}` e a troca muda o endereço, sem redirecionamento. Formato `^[a-z0-9_]{3,50}$` e reservados (`me`, `admin`, `api`, `channels`, `videos`, `categories`, `auth`, `docs`, `support`), validados só na edição; a unicidade é decidida pelo `UNIQUE` do banco.
16. **Canal público.** Expõe `name`, `nickname`, `description`, `created_at` e `video_count` (só publicados e públicos); item da lista: `public_id`, `title`, `thumbnail_url`, `duration_seconds`, `published_at`. Nenhum `id`, `user_id` nem e-mail.

### Transversais
17. **Rate limit.** Throttler nomeado `public-read`, com limite alto por IP, nas rotas públicas novas (categorias, capa, canal público e sua listagem).
18. **Erros novos** (envelope `{ statusCode, error, message }`): `VIDEO_NOT_PUBLISHABLE` (409), `INVALID_CATEGORY` (400), `NICKNAME_ALREADY_EXISTS` (409), `NICKNAME_RESERVED` (400), `INVALID_IMAGE` (415), `IMAGE_TOO_LARGE` (413). Reaproveita `VIDEO_NOT_FOUND`, `CHANNEL_NOT_FOUND` e `VIDEO_NOT_READY`.

## Fora de escopo
- Reabrir qualquer decisão acima na pesquisa; o `/research` pode discordar de uma delas **só** apontando um fato do código ou da biblioteca que a torne inviável, e a discordância vai para o dono decidir.

## Critérios de aceite
- Cada decisão aparece no documento de decisões da fase (`Decision:` coerente com este PRD) ou tem a discordância registrada.
- Os PRDs 01 a 07 e o plano são coerentes com estas decisões.

## Pendentes (não decididas; entram no `/research` como decisão do dono)
- **Rate limit das rotas autenticadas novas** (`PATCH` de vídeo e de canal, painel, publicar, capa): o `ThrottlerGuard` global (10 requisições por minuto por IP) também vale para elas e um painel que recarrega a lista o esgota. Definir se usam o mesmo limite, um limite próprio maior ou o `public-read`.
- Valor exato do limite do throttler `public-read` (a decisão é só que é alto).
