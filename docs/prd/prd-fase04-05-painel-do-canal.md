# PRD: Painel de gerenciamento de vídeos do canal

## Objetivo
Dar ao dono do canal uma listagem de todos os seus vídeos, em qualquer estado, com as informações de gestão, de onde ele parte para a edição.

## Contexto
- `docs/project-plan.md` (Fase 04): "painel de gerenciamento de vídeos do canal (thumbnail, título, visualizações, likes, comentários, tempo de publicação e status)" e "edição de vídeos a partir do painel". A tela é frontend; aqui vale a API que a alimenta.
- Estado atual: não existe nenhum endpoint de listagem, nem de canal (`nestjs-project/src/channels/` só tem serviço e entidade). O usuário tem exatamente um canal.
- Visualizações, likes e comentários **não existem ainda**: visualizações vêm da página de vídeo (Fase 05) e likes e comentários da Fase 06. A listagem precisa do formato desses campos agora sem inventar dado.
- O guard global limita a 10 requisições por minuto por IP (Fase 02); um painel que recarrega a lista precisa de folga (a Fase 03 liberou só as rotas públicas de leitura de vídeo desse limite).

- **Decidido** (PRD 00, decisões 12, 13, 14, 19 e 25): rota `GET /channels/me/videos`, implementada no módulo de vídeos (o `ChannelsService` só resolve o canal); `views`, `likes` e `comments` com `0` fixo no contrato; paginação `page` + `limit` (20 padrão, 50 máximo) com `total` e `total_pages`; **sem filtros nem `sort`** nesta fase (cada item já traz `status`, `visibility` e `published_at`); throttler `authenticated`, 120 por minuto por usuário.
## Requisitos
1. O dono lista os vídeos do próprio canal, de todos os status, mais recentes primeiro, com paginação.
2. Cada item traz: `public_id`, título, capa (PRD 03), status de processamento, estado editorial e visibilidade (PRD 04), instante de publicação, criação, e contagens de visualizações, likes e comentários.
3. A listagem tem ordem fixa, mais recente primeiro (sem filtros nem parâmetro de ordenação nesta fase).
4. Só vale para o canal do usuário autenticado; não existe parâmetro que liste vídeos de outro canal.
5. As contagens de visualizações, likes e comentários têm um valor definido enquanto as Fases 05 e 06 não existem, e o contrato não muda quando elas chegarem.
6. Requisição anônima retorna 401.
7. A consulta é eficiente (índices e sem N+1) para canais com muitos vídeos.

## Fora de escopo
- Filtros do painel por status, estado editorial e visibilidade.
- A tela do painel e as ações em lote.
- Cálculo real de visualizações, likes e comentários (Fases 05 e 06).
- Exclusão de vídeos.

## Critérios de aceite
- Com vídeos em `draft`, `processing`, `ready` e `error`, o dono vê todos, e outro usuário não vê nenhum deles (req. 1, 4).
- A ordem é `created_at` decrescente, com desempate por id (req. 3).
- A paginação devolve páginas estáveis e o total (req. 1).
- As contagens vêm como números definidos (req. 2, 5).
- Anônimo recebe 401 (req. 6).

## Lacunas (→ `/research`)
- Como contar por usuário no `ThrottlerGuard` (gerador de chave pelo `sub` do JWT) e como cada rota ignora os throttlers que não são dela.
- Consulta eficiente (índice por canal e ordenação; sem N+1 na capa e na categoria).
