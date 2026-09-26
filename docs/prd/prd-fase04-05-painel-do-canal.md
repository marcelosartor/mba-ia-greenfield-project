# PRD: Painel de gerenciamento de vídeos do canal

## Objetivo
Dar ao dono do canal uma listagem de todos os seus vídeos, em qualquer estado, com as informações de gestão, de onde ele parte para a edição.

## Contexto
- `docs/project-plan.md` (Fase 04): "painel de gerenciamento de vídeos do canal (thumbnail, título, visualizações, likes, comentários, tempo de publicação e status)" e "edição de vídeos a partir do painel". A tela é frontend; aqui vale a API que a alimenta.
- Estado atual: não existe nenhum endpoint de listagem, nem de canal (`nestjs-project/src/channels/` só tem serviço e entidade). O usuário tem exatamente um canal.
- Visualizações, likes e comentários **não existem ainda**: visualizações vêm da página de vídeo (Fase 05) e likes e comentários da Fase 06. A listagem precisa do formato desses campos agora sem inventar dado.
- O guard global limita a 10 requisições por minuto por IP (Fase 02); um painel que recarrega a lista precisa de folga (a Fase 03 liberou só as rotas públicas de leitura de vídeo desse limite).

- **Decidido** (PRD 00, decisões 12, 13 e 14): rota `GET /channels/me/videos`; `views`, `likes` e `comments` com `0` fixo no contrato; paginação `page` + `limit` (20 padrão, 50 máximo) com `total` e `total_pages`.
## Requisitos
1. O dono lista os vídeos do próprio canal, de todos os status, mais recentes primeiro, com paginação.
2. Cada item traz: `public_id`, título, capa (PRD 03), status de processamento, estado editorial e visibilidade (PRD 04), instante de publicação, criação, e contagens de visualizações, likes e comentários.
3. A listagem filtra por status de processamento e por estado editorial, e ordena por data.
4. Só vale para o canal do usuário autenticado; não existe parâmetro que liste vídeos de outro canal.
5. As contagens de visualizações, likes e comentários têm um valor definido enquanto as Fases 05 e 06 não existem, e o contrato não muda quando elas chegarem.
6. Requisição anônima retorna 401.
7. A consulta é eficiente (índices e sem N+1) para canais com muitos vídeos.

## Fora de escopo
- A tela do painel e as ações em lote.
- Cálculo real de visualizações, likes e comentários (Fases 05 e 06).
- Exclusão de vídeos.

## Critérios de aceite
- Com vídeos em `draft`, `processing`, `ready` e `error`, o dono vê todos, e outro usuário não vê nenhum deles (req. 1, 4).
- Filtros por status e por estado editorial retornam só o que casa (req. 3).
- A paginação devolve páginas estáveis e o total (req. 1).
- As contagens vêm como números definidos (req. 2, 5).
- Anônimo recebe 401 (req. 6).

## Lacunas (→ `/research`)
- **Rate limit das rotas autenticadas** (pendente do PRD 00): o painel e as edições usam o `ThrottlerGuard` global de 10 requisições por minuto por IP; decidir o limite.
- Consulta eficiente (índice por canal e ordenação; sem N+1 na capa e na categoria).
- Filtros aceitos (status de processamento, estado editorial, visibilidade) e a combinação entre eles.
