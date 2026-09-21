# PRD: Infraestrutura da Fase 03 — object storage, fila e worker

## Objetivo
Disponibilizar, junto da stack Docker do backend, os três componentes que a Fase 03 exige e que hoje não existem: object storage para vídeos e thumbnails, fila de processamento em segundo plano e um worker de vídeo que consome essa fila.

## Contexto
- `docs/project-plan.md` (Fase 03) lista "serviço de armazenamento de arquivos (vídeos e thumbnails)" e "serviço de processamento em segundo plano (filas)".
- O `compose.yaml` atual (`nestjs-project/`) tem apenas API, PostgreSQL e Mailpit.
- A arquitetura-alvo (`docs/diagrams/software-arch.mermaid` e CLAUDE.md) já prevê Object Storage (S3/MinIO), Message Queue (TBD) e Video Worker (FFmpeg).
- Enunciado da Fase 03: o object storage é dado (S3 compatível, MinIO local); a tecnologia de fila é a decisão em aberto.
- Regra do projeto: entre serviços usa-se o nome do serviço do Compose como host, nunca `localhost`.

## Requisitos
1. O `compose.yaml` sobe um serviço de object storage compatível com S3 (MinIO) junto da stack existente.
2. O `compose.yaml` sobe um serviço de fila para o processamento de vídeos.
3. O `compose.yaml` sobe o worker de vídeo como processo/container separado da API.
4. O worker tem FFmpeg/ffprobe disponível em runtime.
5. API e worker acessam storage e fila pelo nome do serviço do Compose, configurados por variáveis de ambiente (`.env.example` atualizado).
6. Os buckets necessários existem ao subir a stack, sem passo manual.
7. Os novos serviços têm healthcheck e a API/worker só iniciam depois que dependem deles estarem saudáveis.

## Fora de escopo
- Interface de vídeo no frontend (`next-frontend/`).
- Troca para S3 real em produção (o enunciado só cita como evolução).

## Critérios de aceite
- `docker compose up -d` sobe storage, fila, worker, API, banco e Mailpit; `docker compose ps` mostra todos saudáveis/em execução (req. 1–3, 7).
- `ffprobe -version` executa dentro do container do worker (req. 4).
- Nenhuma configuração dos novos serviços usa `localhost` (req. 5).
- Os buckets existem logo após o `up`, verificável pelo cliente S3 (req. 6).
- Testes de integração exercitam storage e fila reais do Compose, sem mock.

## Lacunas (→ `/research`)
- Qual tecnologia de fila (decisão em aberto do enunciado).
- Onde vive o código do worker (mesmo pacote do `nestjs-project/` ou separado) e como é empacotado.
- Organização de buckets e chaves (um bucket ou dois; prefixos).
- Política de reentrega/retentativa da fila.
