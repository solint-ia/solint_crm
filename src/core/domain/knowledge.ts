import type { Id } from './shared';

/**
 * Base de conhecimento / central de ajuda (§15).
 *
 * Serve a dois leitores ao mesmo tempo: o cliente, que busca a resposta sozinho
 * no portal público, e o agente, que cola o artigo dentro do atendimento. Por
 * isso o artigo carrega tanto `content` (o texto) quanto `excerpt` (o que cabe
 * numa lista) e a contagem de "isto ajudou?" — o único sinal que diz se o texto
 * está fazendo o trabalho.
 */

export const ARTICLE_STATUSES = ['publicado', 'rascunho', 'arquivado'] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export const ARTICLE_STATUS_LABELS: Readonly<Record<ArticleStatus, string>> = {
  publicado: 'Publicado',
  rascunho: 'Rascunho',
  arquivado: 'Arquivado',
};

export interface KnowledgeCategory {
  readonly id: Id;
  readonly accountId: Id;
  readonly name: string;
  readonly description: string;
  readonly order: number;
}

export interface KnowledgeArticle {
  readonly id: Id;
  readonly accountId: Id;
  readonly categoryId: Id;
  readonly title: string;
  readonly slug: string;
  readonly excerpt: string;
  readonly content: string;
  readonly status: ArticleStatus;
  readonly updatedLabel: string;
  readonly authorName: string;
  readonly views: number;
  readonly helpful: number;
  readonly notHelpful: number;
  readonly tags: readonly string[];
}

export interface KnowledgeBase {
  readonly categories: readonly KnowledgeCategory[];
  readonly articles: readonly KnowledgeArticle[];
}

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/** Busca sem acento e sem caixa: quem digita "reembolso" acha "Reembôlso". */
export const searchArticles = (
  articles: readonly KnowledgeArticle[],
  term: string,
): readonly KnowledgeArticle[] => {
  const needle = normalize(term.trim());
  if (!needle) return articles;

  return articles.filter((article) =>
    [article.title, article.excerpt, article.content, ...article.tags].some((field) =>
      normalize(field).includes(needle),
    ),
  );
};

/**
 * Proporção de "isto ajudou" — em pontos percentuais inteiros.
 * Sem votos não existe taxa: devolver 0% mentiria sobre um artigo novo.
 */
export const helpfulRateOf = (article: KnowledgeArticle): number | undefined => {
  const total = article.helpful + article.notHelpful;
  return total === 0 ? undefined : Math.round((article.helpful / total) * 100);
};

/** Artigos que o portal público exibe. Rascunho e arquivado nunca vazam. */
export const publicArticles = (
  articles: readonly KnowledgeArticle[],
): readonly KnowledgeArticle[] => articles.filter((article) => article.status === 'publicado');

export const articlesOfCategory = (
  articles: readonly KnowledgeArticle[],
  categoryId: Id,
): readonly KnowledgeArticle[] => articles.filter((article) => article.categoryId === categoryId);

/** Slug estável a partir do título, para a URL do portal. */
export const slugify = (title: string): string =>
  normalize(title)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
