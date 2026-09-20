# PRD: Processamento automático do vídeo (metadados, thumbnail e ciclo de status)

## Objetivo
Processar em segundo plano cada vídeo enviado: extrair duração e metadados, gerar o thumbnail a partir de um frame e refletir o andamento no status do vídeo, inclusive em caso de falha.

## Contexto
- `docs/project-plan.md` (Fase 03): "processamento automático do vídeo após upload (extração de duração e metadados)" e "geração automática de thumbnail a partir de um frame do vídeo".
- Enunciado: o status segue rascunho → processando → pronto/erro; o que acontece em caso de falha no processamento é decisão de research; o worker roda como processo/container separado e usa FFmpeg/ffprobe.
- Depende do PRD 01 (fila, worker, storage) e do PRD 02 (vídeo enviado e cadastrado).

## Requisitos
1. Concluído o upload, o vídeo é publicado como job na fila de processamento.
2. O worker consome o job, e o status do vídeo passa a "processando".
3. O worker extrai duração e metadados do arquivo e os grava no vídeo.
4. O worker gera um thumbnail a partir de um frame do vídeo e o grava no object storage, guardando a chave no vídeo.
5. Em caso de sucesso, o status passa a "pronto".
6. Em caso de falha no processamento, o status passa a "erro".
7. O ciclo de status é refletido no banco a cada transição.

## Fora de escopo
- Transcodificação em múltiplas resoluções/qualidades (não consta no plano nem no enunciado).
- Thumbnail customizada (Fase 04).

## Critérios de aceite
- Após um upload real, o vídeo chega a "pronto" com duração, metadados e chave de thumbnail preenchidos (req. 3–5, 7).
- O thumbnail existe no object storage sob a chave gravada (req. 4).
- Um arquivo inválido/corrompido leva o vídeo a "erro" (req. 6).
- Teste de integração/e2e exercita fila, worker e FFmpeg reais do Compose, sem mock (req. 1–2).

## Lacunas (→ `/research`)
- Como o worker extrai metadados e escolhe o frame do thumbnail (posição no vídeo).
- O que acontece em caso de falha: registro da causa, política de retentativa, DLQ e idempotência do job.
- Quais campos de metadados são persistidos e em que formato.
- Comportamento de transições inválidas de status.
