# PRD: Upload de vídeos de até 10GB com pré-cadastro como rascunho

## Objetivo
Permitir que o dono de um canal envie vídeos de até 10GB sem que a API fique presa durante o envio, registrando o vídeo automaticamente como rascunho ao iniciar o upload.

## Contexto
- `docs/project-plan.md` (Fase 03): "upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance" e "pré-cadastro automático do vídeo como rascunho ao iniciar o upload".
- Enunciado: o arquivo não pode passar pela API de forma que trave o sistema; upload direto ao storage (URL pré-assinada / multipart) é o exemplo dado, a estratégia é decisão de research. Passar o arquivo pela API é reprovação automática.
- Cada usuário tem um canal 1:1, criado no cadastro; vídeos pertencem a um canal. O guard JWT é global.
- A entidade de vídeo deve ter, no mínimo: identificação, dono (canal), título, status, chaves de storage do arquivo e do thumbnail, duração e metadados, e o identificador da URL única.

## Requisitos
1. Um usuário autenticado inicia um upload e o sistema cria o vídeo com status rascunho, vinculado ao canal do usuário.
2. O envio dos bytes do vídeo não passa pelo processo da API.
3. O sistema aceita arquivos de até 10GB.
4. Um usuário não pode iniciar upload em nome de canal alheio.
5. Uma migration versionada cria a tabela de vídeos, ligada ao canal.
6. Ao concluir o envio, o sistema é notificado/confirma o término de modo a disparar o processamento (PRD 03).

## Fora de escopo
- Edição de título, descrição, categoria, thumbnail customizada, visibilidade e publicação (Fase 04).
- Tela de upload no frontend.

## Critérios de aceite
- Iniciar upload cria uma linha em `videos` com status rascunho e `channel_id` do usuário autenticado (req. 1, 4, 5).
- Requisição anônima ao início do upload é rejeitada (req. 4).
- Teste de integração faz upload multipart real contra o MinIO do Compose com arquivo de várias partes (req. 2).
- Evidência manual de um arquivo de 10GB enviado sem travar a API, registrada no `progress.md` (req. 3).
- A migration cria a tabela e é reversível (req. 5).

## Lacunas (→ `/research`)
- Estratégia de upload: URL pré-assinada única vs. multipart pré-assinado, tamanho e número de partes.
- Como o término do upload é detectado (confirmação pelo cliente vs. evento do storage).
- Tratamento de upload abandonado ou incompleto (limpeza de rascunhos órfãos e partes soltas).
- Limites e validações (tipo/extensão do arquivo, título inicial do rascunho).
