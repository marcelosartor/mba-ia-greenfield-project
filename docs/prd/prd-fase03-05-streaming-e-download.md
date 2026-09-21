# PRD: Streaming e download do vídeo

## Objetivo
Permitir assistir ao vídeo sem baixá-lo por completo e permitir que o usuário baixe o arquivo.

## Contexto
- `docs/project-plan.md` (Fase 03): "reprodução via streaming (sem necessidade de download completo)" e "download do vídeo pelo usuário"; entregável "streaming funcionando".
- Enunciado: streaming por requisições com range / 206 Partial Content é o exemplo dado; a estratégia é decisão de research.
- Visitantes anônimos assistem livremente; recursos sociais exigem autenticação (CLAUDE.md, visão geral).
- Depende de PRD 03 (vídeo em "pronto") e PRD 04 (identificador único).

## Requisitos
1. Um vídeo pronto pode ser reproduzido por streaming com requisições parciais.
2. Uma requisição com cabeçalho `Range` recebe 206 e apenas o trecho pedido.
3. Uma requisição sem `Range` é atendida sem exigir carregamento integral em memória da API.
4. O usuário pode baixar o arquivo completo.
5. Vídeo inexistente ou fora de "pronto" não é servido, com erro adequado.

## Fora de escopo
- Player e página de visualização (Fase 05).
- Visibilidade público/unlisted e regras de publicação (Fase 04).
- Contagem de visualizações.

## Critérios de aceite
- Teste e2e: `Range: bytes=0-1023` retorna 206 com `Content-Range` correto e 1024 bytes (req. 1–2).
- Teste e2e: download retorna o arquivo íntegro (req. 4).
- Vídeo em rascunho/processando/erro retorna o erro de domínio previsto no plano (req. 5).
- A API não bufferiza o arquivo inteiro (req. 3).

## Lacunas (→ `/research`)
- Streaming pela API (proxy com Range) vs. redirecionamento para URL pré-assinada do storage.
- Autenticação/anonimato nesses endpoints nesta fase, dado que a visibilidade só chega na Fase 04.
- Cabeçalhos de download (`Content-Disposition`, nome do arquivo) e cache.
