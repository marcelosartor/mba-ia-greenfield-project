# PRD: Visibilidade e fluxo de rascunho → publicação

## Objetivo
Dar ao dono controle sobre quando e para quem o vídeo aparece: publicar e despublicar, e escolher entre visibilidade pública e não listada.

## Contexto
- `docs/project-plan.md` (Fase 04): "visibilidade do vídeo: público (aparece para todos) ou unlisted (somente via link)" e "fluxo de rascunho → publicação".
- **A Fase 03 deixou isto para cá:** `docs/phases/phase-03-videos/phase-03-videos.md` (Authorization Matrix) registra que até a Fase 04 qualquer vídeo `ready` é alcançável por quem tiver o `public_id`, "como um vídeo não listado", e que a Fase 04 acrescenta o bloqueio dos não publicados. A decisão TD-08 da Fase 03 pede publicação e visibilidade como colunas **separadas** do status de processamento (`draft` | `processing` | `ready` | `error`), sem sobrecarregá-lo.
- Estado atual: `GET /videos/{public_id}`, `/stream` e `/download` só checam `status = ready` (`VideosService.getReadyVideo`, `VideoStreamingService`); o `Cache-Control: no-cache` foi escolhido justamente por não haver visibilidade.
- Atenção à palavra "rascunho": na Fase 03 o status `draft` significa upload em andamento ou concluído aguardando o worker; na Fase 04 "rascunho → publicação" é o estado editorial do vídeo. Não são a mesma coisa.

## Requisitos
1. Um vídeo tem um estado editorial (rascunho ou publicado) e uma visibilidade (pública ou não listada), independentes do status de processamento.
2. O dono publica um vídeo seu somente se o processamento terminou (`ready`); publicar registra o instante da publicação.
3. O dono despublica um vídeo, que volta a rascunho; e altera a visibilidade a qualquer momento.
4. Vídeo em rascunho só é acessível ao dono nas leituras (`metadados`, `stream`, `download`, e a capa do PRD 03); para os demais, comporta-se como inexistente ou como não disponível (decisão de pesquisa).
5. Vídeo publicado e não listado é acessível a quem tiver o link, mas não aparece em nenhuma listagem pública (PRD 06).
6. Vídeo publicado e público é acessível e aparece nas listagens públicas.
7. Uma migration versionada e reversível acrescenta os campos e define o que acontece com os vídeos já existentes.

## Fora de escopo
- Publicação agendada, moderação e bloqueio por denúncia.
- Listagens e busca (PRD 06 e Fase 07).

## Critérios de aceite
- Publicar um vídeo `ready` o torna acessível a anônimos; publicar um vídeo ainda em processamento é recusado (req. 2, 6).
- Depois de despublicar, um anônimo não lê metadados, `stream` nem `download`, e o dono continua lendo (req. 3, 4).
- Um vídeo não listado responde ao link e não aparece na listagem pública do canal (req. 5).
- Só o dono publica, despublica e muda visibilidade: outro usuário 403, anônimo 401 (req. 2, 3).
- A migration é reversível e os vídeos existentes têm estado definido (req. 7).

## Lacunas (→ `/research`)
- Representação: colunas separadas de visibilidade e `published_at`, ou uma máquina de estados; e a interação com as transições por compare-and-set do processamento.
- Como um usuário que não é dono vê um vídeo em rascunho: 404 (esconde a existência) ou 409/403 (a Fase 03 usa 404 e 403 diferentes na sessão de upload).
- Destino dos vídeos `ready` que já existem: publicados e públicos, ou rascunho.
- Autenticação opcional nas rotas públicas: hoje elas são `@Public()` e ignoram o token; o dono precisa ser reconhecido quando enviar um.
- Efeito sobre `Cache-Control` e sobre o `ETag` de `stream` e `download`.
