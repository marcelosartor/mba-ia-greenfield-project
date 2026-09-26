# PRD: Edição do canal e página pública do canal

## Objetivo
Permitir que o dono edite nickname, nome e descrição do canal, e expor uma página pública do canal com suas informações e a lista de vídeos publicados.

## Contexto
- `docs/project-plan.md` (Fase 04): "edição das informações do canal: nickname, nome e descrição" e "página pública do canal com informações e listagem de vídeos".
- Estado atual: a entidade `Channel` tem `name` (varchar 50), `nickname` (varchar 50, único) e `description` (text, opcional). O canal é criado no cadastro, com nickname derivado do e-mail (`nickname.util.ts`). Não há controller de canal.
- O nickname é o identificador humano do canal; mudá-lo muda o endereço público, e ele é único na plataforma.
- A listagem pública só mostra vídeos publicados e públicos (PRD 04). Vídeo não listado nunca aparece.
- As rotas públicas precisam ficar fora do limite global de 10 requisições por minuto, como as de leitura de vídeo (lição da Fase 03).

## Requisitos
1. O dono edita nickname, nome e descrição do próprio canal (parcialmente); só ele.
2. Nickname respeita formato e tamanho definidos e é único; conflito retorna 409 sem alterar nada, inclusive sob concorrência.
3. Nome é obrigatório e descrição opcional, com limites definidos.
4. Um endpoint público devolve as informações do canal por nickname: nome, nickname, descrição e data de criação; sem dados do usuário (e-mail, id).
5. Um endpoint público lista os vídeos publicados e públicos do canal, mais recentes primeiro, com paginação, cada item com `public_id`, título, capa e instante de publicação.
6. Canal inexistente retorna 404; vídeos em rascunho, não listados ou fora de `ready` nunca aparecem.
7. Requisição anônima ao endpoint de edição retorna 401.

## Fora de escopo
- Avatar e banner do canal, links e seções personalizadas.
- Inscrições e contagem de inscritos (Fase 06).
- Busca de canais (Fase 07).
- Redirecionamento do nickname antigo depois de uma troca.

## Critérios de aceite
- O dono altera nome, descrição e nickname e a página pública reflete os novos valores (req. 1, 4).
- Nickname já usado por outro canal retorna 409 e o canal não muda; duas trocas simultâneas para o mesmo nickname deixam um vencedor (req. 2).
- A página pública não expõe e-mail nem id do usuário (req. 4).
- A listagem pública contém só vídeos publicados e públicos; um não listado e um em rascunho ficam de fora (req. 5, 6).
- Anônimo tentando editar recebe 401; canal inexistente 404 (req. 6, 7).

## Lacunas (→ `/research`)
- Regras de nickname (formato, mínimo, palavras reservadas, caixa) e como a unicidade é decidida (constraint como árbitro, como no `public_id`).
- Se o endereço público usa o nickname mesmo mudando (e o que acontece com links antigos) ou um identificador estável.
- Formato e estilo de paginação da listagem pública (compartilhado com o PRD 05).
- Como a rota pública sai do limite global sem abrir mão do limite nas rotas de escrita.
