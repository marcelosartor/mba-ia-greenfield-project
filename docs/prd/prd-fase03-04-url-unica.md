# PRD: URL única por vídeo

## Objetivo
Garantir que cada vídeo tenha um identificador público único, sem conflito com outros vídeos, usado na URL do vídeo.

## Contexto
- `docs/project-plan.md` (Fase 03): "URL única por vídeo, sem conflito com outros vídeos"; entregável "URLs únicas geradas".
- Enunciado: a estratégia de URL única é decisão de research. A persistência inclui "o identificador da URL única".
- O vídeo é cadastrado como rascunho no início do upload (PRD 02).

## Requisitos
1. Todo vídeo recebe um identificador de URL único no momento do pré-cadastro.
2. O identificador é único no banco, garantido por restrição de unicidade.
3. Duas criações concorrentes não produzem identificadores iguais.
4. O identificador é estável: não muda com o processamento nem com mudanças de status.
5. Os endpoints públicos do vídeo são resolvidos por esse identificador.

## Fora de escopo
- Slugs baseados em título e URL amigável editável (não constam no plano da fase).

## Critérios de aceite
- A migration define a restrição de unicidade do identificador (req. 2).
- Teste cria vídeos em sequência/concorrência e não observa colisão (req. 1, 3).
- O identificador é o mesmo antes e depois do processamento (req. 4).
- Consulta pelo identificador retorna o vídeo correto (req. 5).

## Lacunas (→ `/research`)
- Formato do identificador (ex.: aleatório curto vs. UUID) e como lidar com a rara colisão.
- Se o identificador exposto é o mesmo da chave primária.
