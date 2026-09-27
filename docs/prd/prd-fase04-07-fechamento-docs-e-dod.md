# PRD: Fechamento da Fase 04 — documentação e Definition of Done

## Objetivo
Deixar a documentação de IA, o contrato da API e o diagrama fiéis ao que a Fase 04 entrega, e provar a Definition of Done técnica do projeto.

## Contexto
- `CLAUDE.md` (raiz) e `nestjs-project/CLAUDE.md` descrevem a arquitetura e as regras; a Fase 03 os atualizou e o diagrama `docs/diagrams/software-arch.mermaid` reflete a fila e o storage.
- O contrato consumido pelo frontend é o `nestjs-project/openapi.json`, gerado por `npm run openapi:export` (Nest CLI, para o plugin do swagger preencher os DTOs) e os exemplos ficam em `nestjs-project/api.http`.
- A Definition of Done do projeto exige testes, `npx tsc --noEmit` e `npm run lint` no contêiner. Aprendizado da Fase 03: o Jest não checa tipos, então o `tsc` precisa rodar depois de integrar várias branches.

## Requisitos
1. Os dois `CLAUDE.md` descrevem os módulos, endpoints, regras de acesso (rascunho, publicado, público, não listado) e comandos novos da fase, sem citar arquivo, endpoint ou comportamento inexistente.
2. O `openapi.json` versionado traz todos os endpoints novos, com erros documentados pelo envelope compartilhado e segurança correta em cada um (rotas públicas sem `access-token`), e a exportação é idempotente.
3. O `api.http` traz um exemplo para cada endpoint novo.
4. O diagrama descreve o que mudou de fluxo (se algo mudou); a coerência entre diagrama e código é conferida.
5. Cada endpoint novo tem teste e2e com cenários de sucesso, autorização (anônimo, outro usuário, dono) e validação.
6. Suíte completa, e2e, `tsc` e lint passam no contêiner, com as saídas registradas no `progress.md`.
7. Todo endpoint público novo está fora do limite global de 10 requisições por minuto (usa só o `public-read`), e as rotas autenticadas novas respeitam o limite por usuário do throttler `authenticated`, com testes que provam os dois.
8. Regras e decisões antigas alinhadas: `.claude/rules/nestjs-controllers.md` (exceção de segurança opcional para `@OptionalAuth()`), `.claude/rules/auth-jwt.md` (throttlers nomeados) e o novo documento de decisões registra como **Revision** a TD-07 da Fase 03, a Authorization Matrix e o `Cache-Control`.
9. O `progress.md` registra o frontend da fase (painel e página pública) como pendência do ciclo `phase-04-gerenciamento-frontend`.

## Fora de escopo
- Documentação de usuário final e de operação em produção.
- Frontend da fase (painel e página pública).

## Critérios de aceite
- Todo caminho, comando e serviço citado nos `CLAUDE.md` existe (req. 1).
- Rodar `npm run openapi:export` de novo não produz diferença no `openapi.json` (req. 2).
- `docker compose exec nestjs-api npm test -- --runInBand`, `npm run test:e2e`, `npx tsc --noEmit` e `npm run lint` terminam com código 0 (req. 6).
- 25 chamadas seguidas a cada endpoint público novo não recebem 429, e a 121ª chamada por minuto de um mesmo usuário a uma rota autenticada comum recebe 429 sem afetar outro usuário (req. 7).
- As duas regras e a Revision da Fase 03 estão registradas (req. 8, 9).

## Lacunas (→ `/research`)
- Nenhuma decisão técnica própria: a documentação segue as decisões dos PRDs 01 a 06.
