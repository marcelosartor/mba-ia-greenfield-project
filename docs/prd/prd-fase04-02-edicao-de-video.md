# PRD: Edição das informações do vídeo

## Objetivo
Permitir que o dono de um vídeo edite título, descrição e categoria, a qualquer momento depois de criado o rascunho.

## Contexto
- `docs/project-plan.md` (Fase 04): "edição das informações do vídeo: título, descrição, categoria e thumbnail customizada" e "edição de vídeos a partir do painel".
- Estado atual (Fase 03): `Video` tem `title` (varchar 100, derivado do nome do arquivo no início do upload) e não tem descrição nem categoria. Só existem endpoints de upload e de leitura pública; nenhum edita o vídeo.
- Dono do vídeo é o usuário cujo canal o possui (`channels.user_id` = `sub` do JWT); a verificação vive no service (`VideoUploadsService.assertOwner`). O guard JWT é global e o formato de erro é `{ statusCode, error, message }`.
- O identificador público é o `public_id`; o UUID interno nunca aparece na API.
- A thumbnail customizada é o PRD 03; visibilidade e publicação, o PRD 04.

## Requisitos
1. O dono edita título, descrição e categoria de um vídeo seu, em uma ou mais chamadas parciais (só o que vier no corpo muda).
2. Título é obrigatório e não vazio, com o limite da coluna; descrição é opcional, com limite definido; categoria é opcional e referencia uma categoria existente (PRD 01).
3. Só o dono edita: outro usuário autenticado recebe 403 e requisição anônima, 401; vídeo inexistente, 404.
4. Campos que o cliente não pode escrever (status, chaves de storage, `public_id`, dono, métricas do processamento) são recusados, não ignorados em silêncio.
5. Uma migration versionada e reversível acrescenta os campos novos ao vídeo.
6. A resposta traz o vídeo com os campos editáveis atualizados.

## Fora de escopo
- Thumbnail customizada (PRD 03), visibilidade e publicação (PRD 04).
- Edição do arquivo de vídeo em si e reenvio do arquivo.
- Histórico de edições e desfazer.

## Critérios de aceite
- O dono altera título, descrição e categoria e a leitura seguinte devolve os valores novos (req. 1, 6).
- Título vazio, título acima do limite e categoria inexistente retornam 400 (req. 2).
- Outro usuário recebe 403, anônimo 401, `public_id` inexistente 404 (req. 3).
- Corpo com `status`, `video_key` ou `channel_id` retorna 400 e nada muda (req. 4).
- A migration cria as colunas e é reversível (req. 5).

## Lacunas (→ `/research`)
- Em quais status o vídeo pode ser editado (`draft` com upload em andamento, `processing`, `error`) e se editar durante o processamento afeta o worker.
- Limite da descrição e regras de sanitização de texto (o conteúdo será exibido em páginas públicas).
- Se a edição usa `PATCH` parcial ou `PUT` e como se limpa a categoria (valor nulo).
- Como a leitura pública de metadados passa a expor descrição e categoria (contrato de `GET /videos/{public_id}`).
