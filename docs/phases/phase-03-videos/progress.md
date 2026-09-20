# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 15/19 completed

### SI-03.1 — Configurar dependências, namespaces de config e variáveis de ambiente de storage e fila
- **Status:** completed
- **Tests:** 20 passing (env.validation.integration-spec 13, storage.config.spec 3, redis.config.spec 4); `npx tsc --noEmit` exit 0; eslint dos arquivos do SI exit 0
- **Observations:**
  - Dependências instaladas dentro do container: `bullmq@6.3.8`, `@nestjs/bullmq@11.0.5` (CommonJS; a 12.x é ESM-only), `@aws-sdk/client-s3@3.1136.0` e `@aws-sdk/s3-request-presigner@3.1136.0`.
  - Padrões escolhidos pelo plano, não fixados por TD: `STORAGE_REGION=us-east-1` (o SDK exige região) e `VIDEO_PROCESSING_TIMEOUT_MS=1800000` (30 min).
  - `STORAGE_ACCESS_KEY_ID` e `STORAGE_SECRET_ACCESS_KEY` passam a ser obrigatórias na validação de ambiente; o `.env` local (ignorado pelo git) recebeu as chaves novas, e quem clonar o repositório precisa copiá-las do `.env.example`.
  - O comentário do `.env.example` foi escrito sem a palavra "localhost" para que a checagem por grep do critério não dê falso positivo.
  - `npm install` reportou 40 vulnerabilidades no audit do conjunto de dependências (preexistentes na árvore do projeto); tratar `npm audit` é fora do escopo deste SI.

### SI-03.2 — Infra: subir MinIO, buckets e Redis no Compose e instalar FFmpeg na imagem dev
- **Status:** completed
- **Tests:** no tests (Infra); critérios verificados por comando contra a stack no ar: `docker compose ps` (minio e redis saudáveis, `minio-init` Exited (0), nestjs-api em execução), `ffprobe -version`, buckets `videos` e `thumbnails` listados por cliente S3 em `http://minio:9000`, `redis-cli config get maxmemory-policy` = `noeviction`, `grep` de `localhost`/`127.0.0.1` sem ocorrências
- **Observations:**
  - Imagem do storage: `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` (confirmada com `minio --version`). A imagem do `mc` foi fixada por digest, não por tag: `quay.io/minio/mc@sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727` (release `RELEASE.2025-08-13T08-35-41Z`).
  - Evidência para o TD-10 (imagem removida do Docker Hub, presente no quay.io): `docker manifest inspect minio/minio:RELEASE.2025-09-07T16-13-09Z` falhou e `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` e `quay.io/minio/mc:latest` resolveram, em 2026-09-20.
  - FFmpeg vem do `apt` do Debian 12 (bookworm): `ffmpeg`/`ffprobe` 5.1.9-0+deb12u1. Isso confirma a afirmação do TD-04/TD-05 que não veio da doc consultada.
  - `redis:7` resolveu para o Redis 7.4.11, com `--appendonly yes --maxmemory-policy noeviction`.
  - O healthcheck do MinIO usa `mc ready local` (a imagem já traz o `mc`), o que evita escrever `localhost` no `compose.yaml`.
  - Nenhuma porta de `minio` ou `redis` é publicada no host: o tráfego é só pela rede do Compose. O console do MinIO (porta 9001) não é publicado.
  - O `minio-init` é idempotente (`mc mb --ignore-existing`); ao rodar de novo ele imprime "Bucket created successfully" mesmo com o bucket já existente, mas termina com código 0 sem recriar nada.
  - O `compose.yaml` interpola `STORAGE_ACCESS_KEY_ID` e `STORAGE_SECRET_ACCESS_KEY` do `.env` para as credenciais raiz do MinIO; sem elas no `.env` o `minio` não sobe.
  - O serviço `video-worker` fica para o SI-03.11.

### SI-03.3 — Implementar StorageModule com StorageService
- **Status:** completed
- **Tests:** 12 passing (storage.service.spec 7, storage.module.spec 1, storage.service.integration-spec 4, esta contra o MinIO real do Compose); `npx tsc --noEmit` exit 0; eslint e prettier de `src/storage` sem problemas
- **Observations:**
  - Um teste falhou na primeira rodada (1 de 3 tentativas de correção usada): dentro do Jest o erro de DNS do Node vem de outro realm, o SDK o embrulha em `Error: AWS SDK error wrapper for Error: getaddrinfo EAI_AGAIN …` e perde o `code`. O mapeamento para `StorageUnavailableException` passou a olhar também a mensagem (`getaddrinfo`, `ECONNREFUSED`, etc.), e há um teste unitário para esse embrulho.
  - Só falhas de comunicação (erro de rede, timeout e resposta 5xx) viram `STORAGE_UNAVAILABLE` (502). Respostas 4xx do storage (`NoSuchUpload`, `NotFound`, `InvalidRange`, …) sobem intactas como `S3ServiceException`; os SIs que consomem o `StorageService` (03.6 a 03.9, 03.15) decidem o que fazer com elas.
  - `listParts` de um multipart abortado lança `NoSuchUpload` (404, não mapeado); `headObject` de objeto inexistente lança `NotFound`.
  - Os métodos de multipart usam sempre o bucket `videos`; `presignGetObject`, `putObject`, `headObject` e `getObjectRange` recebem o bucket como parâmetro (o `StorageService` expõe `videosBucket` e `thumbnailsBucket`).
  - A validação de `Range` (416) não fica no `StorageService`: `getObjectRange` repassa o intervalo ao storage, e o SI-03.15 confere o tamanho com `headObject` antes.
  - Os testes de integração gravam sob `test-storage/<uuid>/` nos buckets reais e apagam os objetos no `afterAll`; o multipart abortado não deixa objeto.
  - `ListPartsCommand`, `CompleteMultipartUploadCommand` e `AbortMultipartUploadCommand`, que o context7 não tinha devolvido, foram validados pelos tipos do SDK (`tsc`) e pelo teste de integração contra o MinIO real.

### SI-03.4 — Implementar QueueModule com as filas BullMQ
- **Status:** completed
- **Tests:** 6 passing (video-processing.publisher.integration-spec 5, contra o Redis real do Compose; queue.module.spec 1); `npx tsc --noEmit` exit 0; eslint e prettier de `src/queue` sem problemas
- **Observations:**
  - Uma falha na primeira rodada (1 de 3 tentativas de correção usada): o `bullmq@6` trata o `ioredis` como dependência de peer **opcional** (`>=5.0.0`, `peerDependenciesMeta.optional`) e carrega-o só sob demanda; ele não vem junto. Antes eu havia assumido que vinha. Instalei `ioredis@^5.11.1` (linha 5.x, a padrão do BullMQ; a `6.0.0` acabou de sair e não foi usada). A doc do BullMQ (context7) confirma o carregamento sob demanda.
  - Consequência para a documentação: o `library-refs.md` e o TD-01 não citam o `ioredis`, e ele agora é dependência direta do projeto. Não alterei esses arquivos, pois isso invalidaria a cadeia de artefatos do pipeline; a correção deve entrar nos `CLAUDE.md` no SI-03.19.
  - Retenção de jobs escolhida pelo plano: `removeOnComplete` de 24 h ou 1000 jobs e `removeOnFail` de 7 dias. Enquanto o job existe, publicar de novo o mesmo `videoId` não cria outro; depois de removido, uma republicação cria um job novo, que o processor do SI-03.12 trata como no-op para vídeo já `ready`.
  - Os nomes de fila e de job ficam em `queue.constants.ts` (`video-processing`, `video-processing-dlq`, `video-maintenance`; jobs `process-video`, `dead-lettered-video`, `sweep-abandoned-uploads`).
  - O `queue.module.spec.ts` sobrescreve os três providers de fila, para a verificação de DI não abrir conexão com o Redis (unit sem I/O externo); as conexões reais são exercitadas só no teste de integração.
  - Ainda não existe worker consumindo `video-processing`; os jobs publicados ficam em `waiting` até o SI-03.11 (os testes limpam as filas com `obliterate` antes e depois).

### SI-03.5 — Criar migration, entidade Video e repositório
- **Status:** completed
- **Tests:** 22 passing nos arquivos do SI (video.entity.integration-spec 6, videos.repository.integration-spec 10, public-id.util.spec 3, videos.module.spec 1, migrations.integration-spec 2 [atualizado]); suíte completa 198 passing (34 suítes) e e2e 52 passing; `npx tsc --noEmit` exit 0; `npm run lint` 0 erros (23 warnings preexistentes nos specs de auth); prettier sem problemas
- **Observations:**
  - Migration `1789938672313-CreateVideos.ts` gerada pela CLI do TypeORM (`migration:generate`) a partir da entidade e apenas formatada com prettier; aplicada com `migration:run`. `down` remove FK, índices e tabela sem resíduo (coberto pelo spec de migrations).
  - O CHECK de `status` e os nomes `UQ_videos_public_id`, `IDX_videos_channel_id` e `IDX_videos_status_created_at` são declarados na entidade (`@Check`, `@Unique`, `@Index`), então a CLI os gerou sem SQL manual.
  - `duration_seconds` (numeric) e `bit_rate`/`size_bytes` (bigint) voltam do PostgreSQL como string; a entidade converte para `number` com um transformer (tamanhos de até 10 GiB cabem com folga em `Number`).
  - `createDraft` gera o `id` com `randomUUID()` antes do insert para montar `video_key` (`<channel_id>/<video_id>/source.<ext>`) e repete até 5 vezes só quando a violação é de `UQ_videos_public_id`; qualquer outro erro sobe. Não pode rodar dentro de uma transação do chamador (uma violação aborta a transação no PostgreSQL); o SI-03.6 deve chamá-lo fora de transação.
  - `transitionStatus` aceita um status ou uma lista de status esperados e devolve `boolean`; transição inválida é `false`, nunca erro.
  - Entidade `Video` incluída em todos os arrays de entidades dos testes (10 specs) e `cleanAllTables` apaga `videos` primeiro; `Channel` ganhou o lado inverso `videos` (`@OneToMany`).
  - O spec de migrations tinha um deadlock latente: os `DROP TABLE … CASCADE` rodavam em paralelo (`Promise.all`) sobre tabelas ligadas por FK e, com a tabela `videos`, o deadlock passou a aparecer e deixava o banco de testes meio destruído. Os drops agora são sequenciais (3 execuções seguidas estáveis).
  - Ao listar os arrays de entidades, um `grep -v` meu escondeu dois specs de auth (refresh-token e verification-token); a suíte completa acusou a falha e foram corrigidos na mesma rodada.

### SI-03.6 — Endpoint POST /videos
- **Status:** completed
- **Tests:** 24 passing nos arquivos novos (video-uploads.service.spec 16, video-uploads.service.integration-spec 2, test/videos-create.e2e-spec 6 [do spec `videos-create.plan.md`]) + 2 de `ChannelsService.findByUserId`; suíte completa 218 passing (36 suítes), e2e 59 passing; `npx tsc --noEmit` exit 0; `npm run lint` 0 erros (23 warnings preexistentes); prettier sem problemas nos arquivos do SI
- **Observations:**
  - `findByUserId` devolve `null` quando não há canal; quem lança `ChannelNotFoundException` é o `VideoUploadsService`, então o módulo de vídeos não consulta a entidade de outro domínio.
  - A extensão é lida pelo último ponto do nome, não por `path.extname`, porque `extname('.mp4')` devolve vazio; um nome sem ponto ou com extensão fora da allowlist vira 415. O `content_type` é comparado sem diferenciar maiúsculas de minúsculas.
  - Título do rascunho = nome do arquivo sem extensão, com `trim` e no máximo 100 caracteres; se sobrar vazio, `Untitled video`.
  - A compensação de falha vive em `discardDraft`: se o storage falha ou se gravar o `upload_id` falha, o multipart é abortado (só se já foi aberto) e o rascunho é removido, e o erro original é relançado. Se o próprio abort falhar, só há log de aviso; o resto fica para o sweeper do SI-03.13.
  - `VideosRepository` ganhou `setUploadId` e `deleteById` (o SI-03.5 não tinha).
  - `VideosModule` agora depende de `ConfigModule` global (configs de storage e vídeo), então o `videos.module.spec` passou a registrá-lo.
  - O script `test:e2e` não tinha `--runInBand`, apesar de o CLAUDE.md do projeto exigir. Com 4 suítes de e2e limpando as mesmas tabelas em paralelo apareceu contaminação (FK violada em `refresh_tokens`); adicionei `--runInBand` ao script.
  - Criei `test/helpers/e2e-app.ts` (app com pipe e filtros do `main.ts`, `registerConfirmAndLogin`, `buildTestingModule` para overrides) para os e2e dos SIs 03.7 a 03.16 reutilizarem.
  - O cenário de storage indisponível do e2e sobe um segundo app com `storageConfig.KEY` sobrescrito para `http://storage-down:9000` (host inexistente na rede do Compose); o rascunho é removido e a resposta é 502.
  - Os testes de integração e e2e abortam os multiparts que abriram (no `afterEach`), para não acumular uploads incompletos no MinIO.

### SI-03.7 — Endpoint GET /videos/{public_id}/upload
- **Status:** completed
- **Tests:** 14 passing novos (video-uploads.service.spec +6, video-uploads.service.integration-spec +3, test/videos-upload-session.e2e-spec 5 [do spec `videos-upload-session.plan.md`]); suíte completa 227 passing (36 suítes), e2e 64 passing; `npx tsc --noEmit` exit 0; `npm run lint` 0 erros (23 warnings preexistentes); prettier sem problemas nos arquivos do SI
- **Observations:**
  - Os cenários 1.1 e 1.5 do spec usam `POST .../upload/parts` e `/completion`, que só existiam nos SI-03.8 e SI-03.9; na entrega deste SI usavam URLs pré-assinadas geradas pelo `StorageService` e o marcador gravado no banco. **Resolvido no SI-03.9:** os dois cenários agora usam os endpoints reais.
  - `assertOwner` é async e recebe `(userId, video)`: o dono é quem tem canal com `id = video.channel_id`; usuário sem canal também recebe 403. É o método que os SI-03.8 e SI-03.9 reutilizam.
  - Vídeo inexistente responde 404 antes da checagem de dono, como no plano (`VIDEO_NOT_FOUND` vs `VIDEO_ACCESS_DENIED` revelam se o `public_id` existe; é o que o Error Catalog define).
  - `part_size_bytes` da resposta vem da configuração atual (`VIDEO_UPLOAD_PART_SIZE_BYTES`), pois a tabela `videos` não guarda o tamanho da parte; se a variável mudar com um upload em andamento, o valor devolvido muda. O modelo de dados do plano não prevê a coluna, então mantive assim.
  - Para `upload_completed_at` preenchido ou vídeo sem `upload_id`, `uploaded_parts` é vazio e o storage nem é consultado.
  - O DTO de resposta usa `@ApiProperty` explícito (o `openapi:export` roda via ts-node, sem o plugin do Nest CLI); os DTOs de entrada seguem o padrão do projeto, sem decoradores de swagger.
  - `test/helpers/video-e2e.ts` (novo) tem `putPart` e `abortOpenUploads`; este ignora `NoSuchUpload` (upload já concluído ou abortado) e é usado também por `videos-create.e2e-spec.ts`, que perdeu sua cópia privada.

### SI-03.8 — Endpoint POST /videos/{public_id}/upload/parts
- **Status:** completed
- **Tests:** 12 passing novos (video-uploads.service.spec +5, video-uploads.service.integration-spec +2, test/videos-upload-parts.e2e-spec 6 [do spec `videos-upload-parts.plan.md`]); suíte completa 234 passing (36 suítes), e2e 70 passing; `npx tsc --noEmit` exit 0; `npm run lint` 0 erros (23 warnings preexistentes); prettier sem problemas nos arquivos do SI
- **Observations:**
  - O cenário 1.3 do spec (rejeitar depois da conclusão) usa `POST .../upload/completion`, que só existia no SI-03.9; na entrega deste SI o marcador era gravado direto no banco. **Resolvido no SI-03.9:** o cenário agora usa o endpoint real.
  - `part_numbers` é validado por `class-validator` (`ArrayMinSize(1)`, `ArrayMaxSize(100)`, `ArrayUnique`, `IsInt`, `Min(1)`, `Max(10000)` em cada item); os limites estão em `video-upload.constants.ts`. O e2e também cobre repetição, 0, 10001 e item que não é inteiro.
  - A extração do vídeo com verificação de dono virou `loadOwnedVideo` no `VideoUploadsService`, usado por `getUploadSession` e `requestPartUrls`; os SI-03.9 e seguintes de sessão de upload devem reutilizá-lo.
  - Um vídeo com `upload_completed_at` nulo mas sem `upload_id` (estado inconsistente, que o SI-03.6 não produz) lança um `Error` comum (500), não uma exceção de domínio.
  - As URLs saem com o host `minio` do Compose (o teste confere `hostname === 'minio'`). Isso é a decisão do TD-09: sem cliente de browser na Fase 03, e a prova de 10 GiB roda dentro da rede do Docker; `STORAGE_PUBLIC_ENDPOINT` segue configurado mas sem uso, para a fase do frontend.
  - O `PUT` direto do teste vai ao MinIO sem cabeçalho `Authorization` e é aceito, o que confirma que os bytes não passam pela API.

### SI-03.9 — Endpoint POST /videos/{public_id}/upload/completion
- **Status:** completed
- **Tests:** 34 passing novos (video-uploads.service.spec +17 [total 44], video-uploads.service.integration-spec +6, videos.repository.integration-spec +4, test/videos-upload-completion.e2e-spec 7 [do spec `videos-upload-completion.plan.md`]); suíte completa 261 passing (36 suítes), e2e 77 passing; `npx tsc --noEmit` exit 0; `npm run lint` 0 erros (23 warnings preexistentes); prettier sem problemas nos arquivos do SI
- **Observations:**
  - Ordem das validações em `completeUpload`: dono → já concluído (devolve 202 sem tocar em nada) → soma das partes acima de 10 GiB (aborta o multipart, remove o rascunho, 413) → sequência 1..N com partes intermediárias iguais a `part_size_bytes` (409) → `completeMultipartUpload` → UPDATE único (`markUploadCompleted`) → publicação do job. A soma é checada antes da sequência para que o 413 apareça mesmo quando a lista de partes falsa do teste tem tamanhos irregulares.
  - `markUploadCompleted` é `UPDATE … SET upload_completed_at = now(), upload_id = NULL WHERE id = $1 AND upload_completed_at IS NULL` e devolve se atualizou; só publica o job quando devolve `true`.
  - Duas confirmações simultâneas: a segunda chamada lista ou completa um multipart que o storage já não conhece (`NoSuchUpload`). Se o vídeo já está concluído no banco, ela responde 202 sem publicar; se não está, o erro sobe. Um teste de integração com `Promise.all` de duas confirmações confirma um único job.
  - Falha de publicação no Redis é só registrada em log (`Logger.error`) e a resposta continua 202, com o vídeo `draft` e `upload_completed_at` preenchido, para o sweeper (SI-03.13) republicar.
  - Se o UPDATE falhar depois de o multipart já ter sido completado no storage, uma nova tentativa do cliente cai em `NoSuchUpload` e não em `upload_completed_at`; o erro sobe (500). Caso raro, não coberto pelo plano; o sweeper do SI-03.13 é quem lida com vídeos em estado assim.
  - Os testes de integração passam a sobrescrever `videoConfig` com partes de 5 MiB (`overrideProvider`), e os testes de `VideosModule` carregam `redisConfig` porque o módulo agora importa o `QueueModule`. O teste do SI-03.6 que conferia `part_size_bytes: 67108864`/`part_count: 3` passou a conferir 5242880/39 para 200 MB.
  - Criei `src/test/storage-test-client.ts` (cliente S3 direto, independente do código testado) para apagar objetos no `afterEach`, e o helper `discardStoredUploads` em `test/helpers/video-e2e.ts` (aborta multiparts abertos e apaga o objeto final); ele substituiu `abortOpenUploads`. Os e2e de create, session, parts e completion o usam, então não sobram objetos nem uploads incompletos no MinIO.
  - Nesta rodada um `prettier --write src` meu reformatou por engano os templates `.hbs` de e-mail; revertidos com `git checkout` antes do commit (esses dois arquivos já falham no `prettier --check` desde antes, fora do escopo).

### SI-03.10 — Implementar MediaProbeService e ThumbnailService com ffprobe e ffmpeg
- **Status:** completed
- **Tests:** 45 passing (media-probe.service.integration-spec 10, thumbnail.service.integration-spec 6, media-probe.mapper.spec 10, media-tool.spec 11, thumbnail.service.spec 7, media.module.spec 1), ffprobe/ffmpeg reais contra o MinIO real; suíte completa 306 passing (42 suítes), e2e 77 passing; `npx tsc --noEmit` exit 0; `npm run lint` 0 erros (23 warnings preexistentes); prettier sem problemas nos arquivos do SI
- **Observations:**
  - Só `child_process.execFile` (sem shell e sem biblioteca nova): FFmpeg 5.1.9 da imagem dev, com `libx264` e `aac` disponíveis para gerar os arquivos de teste. Não houve consulta ao context7 porque não há biblioteca de terceiros neste SI.
  - Classificação de falhas em `media-tool.ts`: timeout, abort e sinal de morte viram `TransientMediaError`; se o `stderr` menciona leitura remota (`Server returned`, conexão recusada/resetada, DNS, `Input/output error`) também é transitório; qualquer outro `stderr` (`Invalid data found`, `moov atom not found`, sem trilha de vídeo) é `InvalidMediaError`. Binário ausente vira `Error` comum (retentável pelo processor). `MediaError` tem a flag `retryable` para o processor do SI-03.11/03.12 decidir entre `UnrecoverableError` e nova tentativa.
  - As mensagens de erro passam por `redactUrls`: a URL pré-assinada carrega a assinatura na query string e as mensagens vão para `videos.error_message` e para o log, então `http(s)://…` vira `<url>` (teste garante que `X-Amz-Signature` não aparece).
  - Ambas as ferramentas recebem `-protocol_whitelist http,https,tcp,tls,crypto`; um `file:///etc/passwd` é recusado (teste). O plano não pediu isso; escolha minha para que a origem só possa ser HTTP(S).
  - Streams com `disposition.attached_pic = 1` (capa de MP3/M4A) não contam como trilha de vídeo, então áudio com capa é `InvalidMediaError`. Sem `duration` no formato, cai para a duração da trilha de vídeo; se nenhuma existir, `duration_seconds` é `null` (a coluna aceita) e o thumbnail usa o instante 0.
  - `metadata` (JSONB) guarda o `format` e os `streams` reduzidos a campos técnicos; as `tags` do arquivo (título, autor, localização, etc.) ficam de fora de propósito.
  - Thumbnail: `-ss` antes do `-i` (busca por Range, sem baixar o arquivo), `scale=640:-1` para preservar a proporção, arquivo temporário em `os.tmpdir()` sempre removido (`finally`; testado em sucesso e em falha). O teste do instante usa um vídeo preto por 0,5 s seguido de branco: em 10 s o frame de 1 s é branco (luma > 200) e sem duração (instante 0) é preto (luma < 50).
  - O critério "sem baixar o arquivo inteiro para o disco do worker" é garantido por construção (só a URL é passada ao ffprobe) e o teste confere que nada novo aparece em `os.tmpdir()` ao sondar um MP4 com o `moov` no fim (`moov` depois de `mdat`, conferido nos bytes). Não medi os bytes trafegados; a medição de tráfego da API fica para a prova do SI-03.18.
  - O timeout usa `videoConfig.processingTimeoutMs` (padrão 30 min); o teste cria o serviço com 1 ms para provocar o timeout. Ambos os métodos aceitam um `AbortSignal` opcional para o processor cancelar.
  - Fixtures: `src/test/media-fixtures.ts` (`generateMp4`, `generateBlackThenWhiteMp4`, `readJpegSize`, `averageLuma`), reutilizável nos testes do processor (SI-03.11 e 03.12).
  - O `MediaModule` só depende do `ConfigModule` global (para `videoConfig`); os serviços recebem a URL pronta, então ele não importa o `StorageModule`.

### SI-03.11 — Criar o worker e o VideoProcessor (caminho feliz)
- **Status:** completed
- **Tests:** 7 passing novos (video.processor.integration-spec 5, worker.module.spec 2) + 6 novos de `VideosRepository` (`findById`, `startProcessing`) + 1 de env (`QUEUE_PREFIX`) e 1 de `redisConfig` ajustados; suíte completa 319 passing (44 suítes), e2e 77 passing; `npx tsc --noEmit` exit 0; `npm run lint` 0 erros (23 warnings preexistentes); prettier sem problemas nos arquivos do SI. Verificação de infra contra a stack no ar: `docker compose up -d video-worker` sobe o serviço, `ffprobe` 5.1.9 disponível no contêiner, nenhuma porta publicada e nenhum socket TCP escutando (só o DNS embutido do Docker em 127.0.0.11), e um vídeo publicado no prefixo `bull` chegou a `ready` pelo worker do Compose (duração 4, 320x240, h264, `thumbnail_key` gravada)
- **Observations:**
  - **Isolamento dos testes por prefixo de fila (necessidade descoberta aqui, fora do plano):** com o `video-worker` no Compose consumindo `video-processing`, qualquer teste que publicasse jobs (e2e de conclusão, integração) competiria com ele. Adicionei `QUEUE_PREFIX` (padrão `bull`; `redisConfig.queuePrefix`, Joi, `.env.example`, `.env` local), aplicado pelo `QueueModule` ao `forRootAsync` (o worker herda o prefixo das filas), e o `test/jest-setup-env.js`, carregado antes do dotenv nos dois jest configs, força `streamtube-test` nos testes. Prova de que era real: ao subir o worker pela primeira vez ele consumiu jobs órfãos de rodadas anteriores do e2e no prefixo `bull` (vídeos já apagados; ele os ignorou com aviso).
  - `WorkerModule` importa `appConfigModule`, `DatabaseModule`, `QueueModule`, `StorageModule`, `MediaModule`, `VideosRepositoryModule` e `UsersModule`; o `UsersModule` está lá só para registrar `User` e `Channel`, porque o TypeORM exige o grafo inteiro de entidades de `Video` (Video → Channel → User) e a falha era "Entity metadata for Video#channel was not found". Não há controllers.
  - Refatorações mínimas para não duplicar configuração entre API e worker: `src/config/app-config.module.ts` (o `ConfigModule.forRoot` global), `src/database/database.module.ts` (o `TypeOrmModule.forRootAsync`) e `src/videos/videos-repository.module.ts` (entidade + repositório, sem controller); `AppModule` e `VideosModule` passaram a usá-los, sem mudar comportamento.
  - Transições do processor: `VideosRepository.startProcessing` faz `draft`/`processing` → `processing` exigindo `upload_completed_at IS NOT NULL` (a reentrada `processing` → `processing` cobre retentativa e redelivery) e a conclusão usa `transitionStatus(processing → ready)` com metadados, `thumbnail_key` e `error_code`/`error_message` nulos. Vídeo inexistente ou fora de `draft`/`processing` termina o job como no-op com log (isso já adianta parte da idempotência do SI-03.12, que acrescenta os testes e os caminhos de falha).
  - A concorrência vem de `videoConfig.workerConcurrency`, que um argumento de decorator não consegue ler; ela é aplicada em `onApplicationBootstrap` por `this.worker.concurrency = …` (o setter existe no `Worker` do BullMQ; a doc do `@nestjs/bullmq` consultada no context7 não cobre configuração dinâmica, então conferi os tipos instalados). Teste confere o valor.
  - A URL pré-assinada da origem vale `processingTimeoutMs` + 60 s, para não expirar durante uma leitura longa. O thumbnail vai para `thumbnails/{videoId}/default.jpg` (chave determinística; retentativa sobrescreve o mesmo objeto).
  - Scripts `start:worker` (`nest start --entryFile worker`) e `start:worker:dev` (com `--watch`); o serviço `video-worker` do Compose usa o segundo, com `restart: unless-stopped`, mesma imagem e volume do `nestjs-api`, e `depends_on` em `db`, `redis` e `minio` saudáveis e `minio-init` concluído.
  - Limitações do modo dev do worker: (a) `nest start --watch` recompila para o mesmo `dist/` que o `start:dev` da API usa (`deleteOutDir` ativo); rodar os dois ao mesmo tempo pode se atropelar na inicialização; (b) `docker compose stop` termina o wrapper do Nest CLI em menos de 1 s com código 1, então o `enableShutdownHooks` do `src/worker.ts` só garante término limpo dos jobs quando o worker roda direto com `node dist/worker` (`start:worker`); um job interrompido é recuperado pelo mecanismo de jobs travados do BullMQ. Não medi o encerramento limpo com `node dist/worker`.
  - O `worker.module.spec` sobrescreve o `VideoProcessor` por `{}` para não iniciar o consumidor da fila durante a checagem de DI, e confere que o módulo não declara controllers.
  - Limpei dos buckets do MinIO local objetos órfãos de rodadas antigas do e2e e do meu teste de fumaça (o teste de fumaça era um script temporário, removido).

### SI-03.12 — Tratar falhas, retentativas, DLQ e idempotência no worker
- **Status:** completed
- **Tests:** 23 passing novos (video.processor.spec 18, video.processor.failures.integration-spec 5, este com Postgres, Redis, MinIO e FFmpeg reais); `video.processor.*` estável em 3 execuções; suíte completa 342 passing (46 suítes), e2e 77 passing; `npx tsc --noEmit` exit 0; `npm run lint` 0 erros (23 warnings preexistentes); prettier sem problemas nos arquivos do SI
- **Observations:**
  - Os cinco cenários do plano passam sem ajuste: arquivo corrompido → `error`/`INVALID_MEDIA` com uma única tentativa (`attemptsMade = 1`) e nada na DLQ; falha transitória nas duas primeiras tentativas → `ready` na terceira (a sonda foi chamada 3 vezes); falha persistente → 3 tentativas, `error`/`PROCESSING_FAILED` e um job `dead-lettered-video` com `{ videoId, failedReason, attemptsMade: 3 }`; job repetido de vídeo `ready` → sem chamar a sonda, `thumbnail_key` e `updated_at` inalterados; redelivery de vídeo em `processing` → `ready` e um único objeto sob `{videoId}/` no bucket de thumbnails.
  - `VideoProcessor.process` só captura `InvalidMediaError`: grava `error`/`INVALID_MEDIA` (transição `processing` → `error`) e lança `UnrecoverableError`. Todo o resto (mídia transitória, storage, rede, banco, inclusive falha ao iniciar) é relançado sem captura, senão o `attempts`/backoff do BullMQ não valeria. Isso é o oposto da regra de "logar e não relançar" das tarefas em segundo plano, aplicada só ao manipulador de evento.
  - O manipulador `@OnWorkerEvent('failed')` roda depois de cada tentativa falha e só age quando a tentativa é a última (`attemptsMade >= opts.attempts`) e o erro não é `UnrecoverableError` (esse caso já foi resolvido em `process` e, como o plano define, não vai para a DLQ). Como um erro escapando de um manipulador de evento seria uma rejeição não tratada que derruba o worker, esse é o único lugar onde falhas são só registradas em log; ele atualiza o vídeo primeiro e publica na DLQ depois, e falha em qualquer dos dois não relança.
  - A transição final de `PROCESSING_FAILED` aceita `processing` ou `draft` como origem: se o banco ficar fora do ar em todas as tentativas de `startProcessing`, o vídeo continua `draft` e ainda assim precisa terminar em `error`.
  - `failedReason` e `error_message` passam por `redactUrls` e são cortados em 500 caracteres antes de ir ao banco e à DLQ (teste com uma URL pré-assinada). Os códigos ficam em `src/videos/video-error-codes.ts`.
  - Os jobs da DLQ não usam `jobId` fixo (um mesmo vídeo pode morrer mais de uma vez ao longo do tempo sem que o segundo registro seja descartado) e não têm consumidor, como no plano; ficam em `waiting` para inspeção.
  - Nos testes de integração os jobs são publicados direto na fila com a mesma política de produção (3 tentativas, backoff exponencial) mas base de 100 ms em vez de 5000 ms, para não somar ~15 s por teste; o `VideoProcessingPublisher` real continua coberto pelos testes dos SI-03.4 e SI-03.9.
  - Pendência que este SI não resolve, para o SI-03.13: um job que falha definitivamente permanece no Redis por 7 dias (`removeOnFail`) com o mesmo `jobId` do vídeo, então uma nova publicação do mesmo `videoId` pelo sweeper seria descartada como duplicada enquanto esse job existir; o sweeper precisa remover o job antigo antes de republicar.

### SI-03.13 — Implementar o sweeper de uploads abandonados e a republicação de jobs
- **Status:** completed
- **Tests:** 21 passing novos (uploads-sweeper.service.integration-spec 11, uploads-sweeper.scheduler.integration-spec 2, video-processing.publisher.integration-spec +4 de `republish`, videos.repository.integration-spec +4 das consultas do sweeper) + `worker.module.spec` ajustado; suíte completa 363 passing (48 suítes), e2e 77 passing; `npx tsc --noEmit` exit 0; `npm run lint` 0 erros (23 warnings preexistentes); prettier sem problemas nos arquivos do SI. Contra a stack no ar: o `video-worker` do Compose registrou o agendador `abandoned-uploads-sweep` (`every 900000`) no Redis e já executou o sweep
- **Observations:**
  - Os quatro critérios do plano passam: rascunho abandonado há 25 h é removido e o multipart deixa de existir (`NoSuchUpload`); rascunho de 1 h fica intacto; vídeo `draft` concluído há 10 min ganha job com `jobId = id` e duas execuções deixam um único job; o agendador existe em `video-maintenance` depois da inicialização (e reiniciar o worker mantém um só agendador, pois é `upsert`).
  - **Resolve a pendência do SI-03.12:** um job que falhou ou completou continua no Redis com o mesmo `jobId`, então publicar de novo seria descartado como duplicado. Criei `VideoProcessingPublisher.republish(videoId)`: job em espera, atrasado ou rodando é deixado como está; job `failed` ou `completed` é removido e o vídeo é publicado de novo (testado com um worker descartável que deixa o job em cada estado). O sweeper usa `republish`, não `publish`.
  - O sweeper roda em segundo plano, então cada vídeo é tratado dentro de um try/catch que registra o erro e segue para o próximo; a linha só é apagada depois de abortar o multipart, portanto uma falha do storage deixa o rascunho para a próxima execução (testado). `NoSuchUpload` no abort conta como sucesso (o multipart já não existe ou foi concluído no meio do caminho).
  - A remoção do rascunho é condicional (`deleteAbandonedDraft`: `WHERE id AND status = 'draft' AND upload_completed_at IS NULL`), para que uma conclusão que corra com o sweeper na fronteira das 24 h nunca perca o vídeo.
  - Escolhas minhas dentro dos números do plano: lote de 200 vídeos por categoria em cada execução (o restante fica para a próxima, sem varrer a tabela inteira), ordem do mais antigo ao mais novo; limites em `uploads-sweeper.constants.ts` (24 h, 5 min, 15 min) e id do agendador em `queue.constants.ts`.
  - O agendador é uma classe própria (`UploadsSweeperScheduler`, `OnApplicationBootstrap`) e o `UploadsSweeperProcessor` só delega ao `UploadsSweeperService`, que é quem tem a lógica e o teste.
  - Os testes do sweeper compilam o `WorkerModule` sem iniciar os consumidores (`VideoProcessor` e `UploadsSweeperProcessor` sobrescritos por `{}` e sem `init()`), para que os jobs publicados fiquem na fila e possam ser contados. Nos demais testes com o `WorkerModule` completo, o agendador também é registrado, no prefixo de teste, sem efeito sobre eles (vídeos de teste são recentes).
  - Limitação conhecida, prevista no TD-03 mas fora do plano: o sweeper parte das linhas do banco. Multiparts abertos no storage que não têm linha (por exemplo, se a criação do rascunho falhar depois de abrir o multipart e a compensação também falhar) não são encontrados; seria preciso listar os multiparts do próprio storage.

### SI-03.14 — Endpoint GET /videos/{public_id}
- **Status:** completed
- **Tests:** 16 passing novos (videos.service.spec 6, videos.service.integration-spec 3, test/videos-get.e2e-spec 7 [do spec `videos-get.plan.md`, com o `it.each` dos três status expandido]); suíte completa 372 passing (50 suítes), e2e 84 passing; `npx tsc --noEmit` exit 0; `npm run lint` 0 erros (23 warnings preexistentes); prettier sem problemas nos arquivos do SI
- **Observations:**
  - `@ApiBearerAuth('access-token')` estava no nível da classe `VideosController` desde o SI-03.6. Como a regra dos controllers proíbe esse decorator em método `@Public()`, movi-o para cada um dos quatro métodos protegidos e o `GET :publicId` ficou só com `@Public()`.
  - O resultado do processamento é semeado no e2e por `UPDATE` (o spec diz que o worker não roda neste teste); o worker do Compose não interfere, pois o e2e usa o prefixo de fila de teste e a app do teste não tem consumidor.
  - A resposta expõe só `public_id`, `title`, `status`, `duration_seconds`, `width`, `height` e `created_at`; um teste unitário confere a lista exata de chaves, para que `video_key`, `thumbnail_key`, `upload_id`, o id interno e os metadados brutos nunca vazem numa rota pública. Outro teste de integração confere que o id interno (uuid) não resolve nada: a busca é só por `public_id`.
  - `duration_seconds`, `width` e `height` são tipados `number | null` no DTO (a coluna aceita nulo quando o ffprobe não informa a duração), embora o contrato do plano os liste como números; um vídeo `ready` sempre tem largura e altura, e a duração só falta em arquivos sem essa informação.
  - `VideosService` ficou separado do `VideoUploadsService`: um cuida da leitura pública de vídeos prontos, o outro da sessão de upload do dono.
  - Um `public_id` de teste com 12 caracteres quebrou a primeira rodada da integração (a coluna é `varchar(11)`); corrigido para 11.

### SI-03.15 — Endpoint GET /videos/{public_id}/stream
- **Status:** completed
- **Tests:** 46 passing novos (range.util.spec 24, video-streaming.service.spec 14, video-streaming.service.integration-spec 6 contra o MinIO real, +2 no `domain-exception.filter.spec`) + 11 no e2e `test/videos-stream.e2e-spec.ts` (do spec `videos-stream.plan.md`, 8 testes, mais três extras: busca no fim do arquivo, `Range` ignorado e abandono do cliente); suíte completa 418 passing (53 suítes), e2e 95 passing; `npx tsc --noEmit` exit 0; `npm run lint` 0 erros (23 warnings preexistentes); prettier sem problemas nos arquivos do SI
- **Observations:**
  - Os cinco critérios do plano passam: `Range: bytes=0-1023` → `206`, `Content-Range: bytes 0-1023/3145728`, `Content-Length: 1024` e os mesmos 1024 primeiros bytes do objeto; sem `Range` → `200` com `Accept-Ranges`, `Content-Length` e o mesmo SHA-256; `Range` além do fim → `416 INVALID_RANGE` com `Content-Range: bytes */3145728`; `draft`/`processing`/`error` → `409`, inexistente → `404`; 200 MiB servidos sem `Range` com SHA-256 igual e crescimento de `heapUsed` abaixo de 50 MiB.
  - O `Content-Range` do 416 exigiu estender `DomainException` com `headers` opcionais (o `DomainExceptionFilter` os aplica antes de responder o envelope). Alternativa descartada: `try/catch` no controller, proibido pela regra dos controllers. `InvalidRangeException(totalBytes)` carrega `Content-Range: bytes */{total}`; dois testes novos no filtro.
  - `parseRange` segue a RFC 9110: `start-end`, `start-` e `-sufixo`; vários intervalos, unidade diferente de `bytes`, sintaxe inválida e `start > end` são ignorados (resposta 200 completa); início além do fim, sufixo zero e qualquer intervalo sobre arquivo vazio são não satisfatórios; `end` maior que o arquivo é limitado ao último byte. O serviço converte intervalo aberto e sufixo em `bytes=início-fim` explícito antes de pedir ao storage e calcula sozinho `Content-Range` e `Content-Length` (não confia nos do storage).
  - O corpo devolvido é o próprio `Readable` do storage dentro de um `StreamableFile`. O `ExpressAdapter` do Nest só faz `stream.pipe(response)` e não destrói a origem quando o cliente desiste; sem tratamento, uma leitura de até 10 GiB ficaria aberta no storage. O controller registra `response.once('close', () => video.body.destroy())`. Teste e2e novo (cliente HTTP que recebe o primeiro chunk e fecha a conexão) e **verificado por mutação**: com a linha comentada ele falha (30 s de espera) e com ela passa.
  - `Cache-Control: no-cache` e `ETag` do objeto saem em todas as respostas de sucesso; `Content-Type` vem do objeto (`video/mp4` gravado no upload), com o do `HEAD` e `application/octet-stream` como reserva.
  - A medida "heap não cresce" foi ajustada em duas rodadas: somar `arrayBuffers` ao `heapUsed` dava falso positivo (82 MB para 100 MiB) porque a memória externa de Buffers já consumidos só é liberada quando o GC roda; o spec pede `heapUsed`, e é o que os testes usam. Acrescentei ao teste de integração uma prova determinística de backpressure: com o consumidor parado depois do primeiro chunk, `readableLength` do stream fica abaixo de 4 MiB em um objeto de 100 MiB.
  - O superagent corta respostas em 200 MB por padrão (`Maximum response size reached`); o helper de leitura em stream do e2e usa `.maxResponseSize(1 GiB)` e um parser próprio que só calcula o hash, sem acumular o corpo.
  - Vídeo `ready` cujo objeto some do storage vira erro do S3 (`NotFound`, sem tratamento de domínio, resposta 500); situação anômala, fora do contrato do plano.
  - `test/videos-stream.e2e-spec.ts` semeia objetos reais (3 MiB, 40 MiB e 200 MiB) e apaga todos no `afterEach`; o de 200 MiB leva ~1,5 s.
  - Helpers novos em `src/test/stream-test-utils.ts` (`randomContent`, `sha256`, `digestStream`), reaproveitáveis no download do SI-03.16.

### SI-03.16 — Endpoint GET /videos/{public_id}/download
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.17 — Publicar o contrato OpenAPI e os exemplos de requisição dos vídeos
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.18 — Provar o upload de 10GB sem travar a API (script e evidência manual)
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.19 — Atualizar CLAUDE.md e o diagrama de arquitetura e fechar a Definition of Done
- **Status:** pending
- **Tests:** —
- **Observations:** none
