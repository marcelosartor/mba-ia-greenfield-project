# PRD: Categorias de vídeo da plataforma

## Objetivo
Oferecer uma lista fixa de categorias de vídeo, mantida pela plataforma, que o dono de um vídeo possa escolher ao editar suas informações.

## Contexto
- `docs/project-plan.md` (Fase 04): "categorias de vídeo disponíveis na plataforma"; a categoria é um dos campos editáveis do vídeo (PRD 02).
- Não existe hoje entidade, tabela nem endpoint de categoria. A entidade `Video` (`nestjs-project/src/videos/entities/video.entity.ts`) não tem campo de categoria.
- O plano não pede que usuários criem ou editem categorias: a lista pertence à plataforma. A busca e a página inicial por categoria são da Fase 07.
- Sem enunciado próprio nesta fase: os requisitos derivam do plano. Não há lista de reprova automática além das regras do `CLAUDE.md`.

- **Decidido** (`docs/prd/prd-fase04-00-decisoes-previas.md`, decisão 8): tabela `categories` com `slug` único, `category_id` nulo em `videos`, lista inicial por migration de dados e o cliente usa o `slug`.
## Requisitos
1. Existe uma lista de categorias, cada uma com identificador estável e nome legível.
2. Um endpoint público lista todas as categorias, em ordem definida e estável.
3. A lista inicial é criada por migration versionada (dados de referência), sem depender de seed manual.
4. Um vídeo pode não ter categoria; quando tem, ela referencia uma categoria existente.
5. Não há criação, edição ou remoção de categorias pela API nesta fase.

## Fora de escopo
- Escolher a categoria de um vídeo (PRD 02) e filtrar vídeos por categoria (Fase 07).
- Painel administrativo de categorias.

## Critérios de aceite
- Depois das migrations, o endpoint de categorias devolve a lista inicial sem autenticação (req. 2, 3).
- A migration cria a tabela e é reversível (req. 3).
- Tentar associar um vídeo a uma categoria inexistente é rejeitado (req. 4; coberto também no PRD 02).
- Teste de integração confere a lista devolvida e a ordem (req. 1, 2).

## Lacunas (→ `/research`)
- Como a migration de dados escrita à mão convive com o `migration:generate` (exceção prevista em `.claude/rules/typeorm-migrations.md`) e como fica o `down`.
- Nomes fixos em português (assumido); confirmar que não há internacionalização nesta fase.
