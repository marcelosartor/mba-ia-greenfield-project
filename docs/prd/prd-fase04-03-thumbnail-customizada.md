# PRD: Thumbnail customizada do vídeo

## Objetivo
Permitir que o dono de um vídeo escolha a própria imagem de capa e volte à capa gerada automaticamente, e que a capa possa ser obtida pelos clientes.

## Contexto
- `docs/project-plan.md` (Fase 04): "thumbnail customizada" entre as informações editáveis; o painel (PRD 05) e a página inicial (Fase 07) exibem a capa.
- Estado atual (Fase 03): o worker gera `thumbnails/{videoId}/default.jpg` (JPEG de 640 px) e grava `thumbnail_key`. O bucket `thumbnails` existe no Compose. **Nenhum endpoint devolve a thumbnail hoje** e a API não expõe `thumbnail_key`.
- Os arquivos enviados são conteúdo não confiável: a lição do SSRF da Fase 03 é que extensão e `content_type` declarados não bastam (o ffprobe/ffmpeg leem pelo conteúdo).
- As URLs pré-assinadas usam o host do Compose (`minio`), inutilizáveis por um browser nesta fase (decisão TD-09 da Fase 03).
- O reprocessamento do worker (republicação, redelivery) reescreve a capa gerada no mesmo objeto.

## Requisitos
1. O dono envia uma imagem como capa customizada de um vídeo seu; ela passa a ser a capa do vídeo.
2. Só formatos de imagem aceitos e com tamanho máximo definido; o conteúdo é validado (não só a extensão nem o `content_type`).
3. O dono remove a capa customizada e o vídeo volta a usar a capa gerada.
4. A capa gerada pelo worker nunca sobrescreve uma capa customizada, mesmo em reprocessamento.
5. Existe um endpoint que devolve a capa de um vídeo (a customizada ou a gerada) sem carregar o arquivo inteiro em memória, respeitando as regras de acesso do PRD 04.
6. Só o dono altera a capa: outro usuário 403, anônimo 401, vídeo inexistente 404.

## Fora de escopo
- Corte e edição da imagem, várias capas por vídeo, escolha de um quadro do vídeo.
- Servir capas por CDN ou URL pública do storage (frontend).
- Redimensionar a capa customizada para vários tamanhos (a menos que a pesquisa decida o contrário).

## Critérios de aceite
- Enviar uma imagem válida troca a capa e o endpoint de capa devolve os bytes enviados (req. 1, 5).
- Arquivo que não é imagem (mesmo com extensão e tipo declarados de imagem) e imagem acima do limite são recusados (req. 2).
- Remover a capa customizada faz o endpoint devolver de novo a capa gerada (req. 3).
- Reprocessar um vídeo com capa customizada não a altera (req. 4).
- Não-dono recebe 403 e anônimo, 401 (req. 6).

## Lacunas (→ `/research`)
- Como a imagem chega ao storage: pela API (é pequena) ou por URL pré-assinada com confirmação, e como o conteúdo é validado nos dois casos.
- Chave da capa customizada e como coexistem a gerada e a customizada (dois campos ou uma chave só).
- Como os clientes obtêm a capa: endpoint na API com streaming, URL pré-assinada de leitura, ou outro (impacta a Fase 07).
- Formatos, dimensões mínimas e máximas e limite de bytes.
