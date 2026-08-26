'use client';

import { useMemo, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  Eye,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import type {
  ArticleStatus,
  KnowledgeArticle,
  KnowledgeBase,
  KnowledgeCategory,
} from '@/core/domain/knowledge';
import {
  ARTICLE_STATUS_LABELS,
  helpfulRateOf,
  searchArticles,
} from '@/core/domain/knowledge';
import type { Tone } from '@/core/domain/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, TextArea, TextInput } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { ConfirmModal } from '@/components/ui/confirm-modal';





import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import {
  deleteArticleAction,
  deleteCategoryAction,
  saveArticleAction,
  saveCategoryAction,
} from '@/app/(workspace)/configuracoes/actions';
import { ArticleEditor, type ArticleDraftInput } from '../knowledge/article-editor';

const STATUS_TONE: Readonly<Record<ArticleStatus, Tone>> = {
  publicado: 'green',
  rascunho: 'amber',
  arquivado: 'slate',
};

const STATUS_FILTERS = [
  { id: 'todos', label: 'Todos' },
  { id: 'publicado', label: 'Publicados' },
  { id: 'rascunho', label: 'Rascunhos' },
  { id: 'arquivado', label: 'Arquivados' },
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number]['id'];

/**
 * Base de conhecimento (§15).
 *
 * O painel de cima não é enfeite: são as quatro perguntas que decidem se vale
 * escrever mais um artigo — quanto já existe, quanto está publicado de fato,
 * quanto é lido e quanto resolve. Um artigo muito visto com aprovação baixa é
 * um problema de atendimento disfarçado de documentação.
 */
export function KnowledgeSection({ knowledge }: { readonly knowledge: KnowledgeBase }) {
  const [categories, setCategories] = useState<readonly KnowledgeCategory[]>(
    knowledge.categories,
  );
  const [articles, setArticles] = useState<readonly KnowledgeArticle[]>(knowledge.articles);
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todos');
  const [term, setTerm] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeArticle | undefined>();
  const [deletingArticle, setDeletingArticle] = useState<KnowledgeArticle | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<KnowledgeCategory | null>(null);
  const [categoryModal, setCategoryModal] = useState<
    { readonly mode: 'nova' } | { readonly mode: 'editar'; readonly category: KnowledgeCategory } | undefined
  >();
  const { show } = useToast();

  const visible = useMemo(() => {
    const byCategory = categoryId
      ? articles.filter((article) => article.categoryId === categoryId)
      : articles;
    const byStatus =
      statusFilter === 'todos'
        ? byCategory
        : byCategory.filter((article) => article.status === statusFilter);
    return searchArticles(byStatus, term);
  }, [articles, categoryId, statusFilter, term]);

  const stats = useMemo(() => {
    const published = articles.filter((article) => article.status === 'publicado');
    const views = articles.reduce((total, article) => total + article.views, 0);
    const votes = articles.reduce(
      (total, article) => total + article.helpful + article.notHelpful,
      0,
    );
    const helpful = articles.reduce((total, article) => total + article.helpful, 0);
    return {
      total: articles.length,
      published: published.length,
      views,
      approval: votes === 0 ? undefined : Math.round((helpful / votes) * 100),
    };
  }, [articles]);

  const handleSaveArticle = async (draft: ArticleDraftInput) => {
    const result = await saveArticleAction(draft);
    if (!result.ok) return result;

    setArticles((current) => {
      if (draft.id) {
        return current.map((article) =>
          article.id === draft.id
            ? {
                ...article,
                categoryId: draft.categoryId,
                title: draft.title,
                excerpt: draft.excerpt,
                content: draft.content,
                status: draft.status,
                tags: draft.tags,
                updatedLabel: 'agora',
              }
            : article,
        );
      }
      const created: KnowledgeArticle = {
        id: `ka-novo-${current.length + 1}`,
        accountId: current[0]?.accountId ?? '',
        categoryId: draft.categoryId,
        title: draft.title,
        slug: '',
        excerpt: draft.excerpt,
        content: draft.content,
        status: draft.status,
        updatedLabel: 'agora',
        authorName: 'Você',
        views: 0,
        helpful: 0,
        notHelpful: 0,
        tags: draft.tags,
      };
      return [...current, created];
    });

    show({
      tone: 'sucesso',
      title: draft.id ? 'Artigo atualizado' : 'Artigo criado',
      description:
        draft.status === 'publicado'
          ? `${draft.title} já está no portal.`
          : `${draft.title} salvo como ${ARTICLE_STATUS_LABELS[draft.status].toLowerCase()}.`,
    });
    return { ok: true };
  };

  const handleConfirmDeleteArticle = async () => {
    if (!deletingArticle) return;
    const article = deletingArticle;
    setDeletingArticle(null);
    const snapshot = articles;
    setArticles((current) => current.filter((item) => item.id !== article.id));
    const result = await deleteArticleAction({ articleId: article.id });
    if (result.ok) {
      show({ tone: 'sucesso', title: 'Artigo excluído', description: article.title });
    } else {
      setArticles(snapshot);
      show({ tone: 'erro', title: 'Não foi possível excluir', description: result.error });
    }
  };

  const handleConfirmDeleteCategory = async () => {
    if (!deletingCategory) return;
    const category = deletingCategory;
    setDeletingCategory(null);
    const result = await deleteCategoryAction({ categoryId: category.id });
    if (!result.ok) {
      // A recusa do domínio é informação útil: diz quantos artigos travam a exclusão.
      show({ tone: 'alerta', title: 'Categoria não excluída', description: result.error });
      return;
    }
    setCategories((current) => current.filter((item) => item.id !== category.id));
    if (categoryId === category.id) setCategoryId(undefined);
    show({ tone: 'sucesso', title: 'Categoria excluída', description: category.name });
  };

  return (
    <div className="flex max-w-5xl flex-col gap-5">
      {editorOpen ? (
        <ArticleEditor
          key={editing?.id ?? 'novo'}
          open
          editing={editing}
          categories={categories}
          defaultCategoryId={categoryId}
          onSave={handleSaveArticle}
          onClose={() => {
            setEditorOpen(false);
            setEditing(undefined);
          }}
        />
      ) : null}

      {categoryModal ? (
        <CategoryModal
          state={categoryModal}
          onClose={() => setCategoryModal(undefined)}
          onSaved={(category) =>
            setCategories((current) =>
              current.some((item) => item.id === category.id)
                ? current.map((item) => (item.id === category.id ? category : item))
                : [...current, category],
            )
          }
        />
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-bold tracking-tight text-ink">
              Base de conhecimento
            </h2>
            <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
              {stats.total} {stats.total === 1 ? 'artigo' : 'artigos'}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">
            Artigos do portal de ajuda e base de consulta rápida para os operadores.
          </p>
        </div>

        <Button
          size="md"
          icon={<Plus className="size-4" />}
          disabled={categories.length === 0}
          title={
            categories.length === 0
              ? 'Crie uma categoria antes de escrever o primeiro artigo.'
              : undefined
          }
          onClick={() => {
            setEditing(undefined);
            setEditorOpen(true);
          }}
        >
          Novo artigo
        </Button>
      </div>

      {/* 4 KPI Cards no Estilo do Dashboard */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-line bg-surface p-4.5 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted">Total de artigos</span>
            <div className="flex size-8 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <BookOpen className="size-4" />
            </div>
          </div>
          <div className="mt-3 font-display text-2xl font-bold text-ink tabular-nums">
            {stats.total}
          </div>
          <span className="mt-1 block text-[11px] text-dim">{categories.length} categorias</span>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-4.5 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted">Publicados</span>
            <div className="flex size-8 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4" />
            </div>
          </div>
          <div className="mt-3 font-display text-2xl font-bold text-ink tabular-nums">
            {stats.published}
          </div>
          <span className="mt-1 block text-[11px] text-green-600 dark:text-green-400 font-semibold">
            {stats.total - stats.published} em rascunho
          </span>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-4.5 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted">Visualizações totais</span>
            <div className="flex size-8 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <Eye className="size-4" />
            </div>
          </div>
          <div className="mt-3 font-display text-2xl font-bold text-ink tabular-nums">
            {stats.views.toLocaleString('pt-BR')}
          </div>
          <span className="mt-1 block text-[11px] text-dim">Leituras realizadas</span>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-4.5 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted">Aprovação dos leitores</span>
            <div className="flex size-8 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <ThumbsUp className="size-4" />
            </div>
          </div>
          <div className="mt-3 font-display text-2xl font-bold text-ink tabular-nums">
            {stats.approval === undefined ? '—' : `${stats.approval}%`}
          </div>
          <span className="mt-1 block text-[11px] text-dim">Dúvidas resolvidas</span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        {/* ---------- Categorias ---------- */}
        <nav aria-label="Categorias" className="min-w-0">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-micro font-semibold tracking-wide text-dim uppercase">
              Categorias
            </h3>
            <button
              type="button"
              onClick={() => setCategoryModal({ mode: 'nova' })}
              aria-label="Nova categoria"
              className="rounded-control p-1 text-dim transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <FolderPlus className="size-3.5" />
            </button>
          </div>

          <ul className="flex gap-2 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
            <li className="shrink-0 md:shrink">
              <button
                type="button"
                onClick={() => setCategoryId(undefined)}
                aria-current={categoryId === undefined ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-control px-3 py-2 text-body transition-colors',
                  categoryId === undefined
                    ? 'bg-accent-soft font-semibold text-brand'
                    : 'text-muted hover:bg-surface-2 hover:text-ink',
                )}
              >
                Todas
                <span className="text-meta text-dim tabular-nums">{articles.length}</span>
              </button>
            </li>

            {categories.map((category) => {
              const count = articles.filter(
                (article) => article.categoryId === category.id,
              ).length;
              const active = category.id === categoryId;
              return (
                <li key={category.id} className="group shrink-0 md:shrink">
                  <div
                    className={cn(
                      'flex items-center gap-1 rounded-control transition-colors',
                      active ? 'bg-accent-soft' : 'hover:bg-surface-2',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setCategoryId(category.id)}
                      aria-current={active ? 'true' : undefined}
                      title={category.description}
                      className={cn(
                        'flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-left text-body transition-colors',
                        active ? 'font-semibold text-brand' : 'text-muted hover:text-ink',
                      )}
                    >
                      <span className="truncate">{category.name}</span>
                      <span className="text-meta text-dim tabular-nums">{count}</span>
                    </button>

                    <span className="flex shrink-0 pr-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        aria-label={`Renomear categoria ${category.name}`}
                        onClick={() => setCategoryModal({ mode: 'editar', category })}
                        className="rounded-control p-1 text-dim hover:text-ink"
                      >
                        <Pencil className="size-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Excluir categoria ${category.name}`}
                        onClick={() => setDeletingCategory(category)}
                        className="rounded-control p-1 text-dim hover:text-red-text"
                      >
                        <Trash2 className="size-3" />
                      </button>

                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* ---------- Artigos ---------- */}
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-dim" />
              <TextInput
                type="search"
                className="pl-8"
                aria-label="Buscar artigos"
                placeholder="Buscar por título, texto ou etiqueta"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
              />
            </div>

            <div className="inline-flex gap-1 rounded-control bg-surface-2 p-1">
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setStatusFilter(filter.id)}
                  aria-pressed={statusFilter === filter.id}
                  className={cn(
                    'rounded-control px-2.5 py-1 text-meta font-semibold transition-colors',
                    statusFilter === filter.id
                      ? 'bg-surface text-brand shadow-xs'
                      : 'text-muted hover:text-ink',
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="size-5" />}
              title={
                articles.length === 0
                  ? 'A base de conhecimento está vazia'
                  : 'Nenhum artigo corresponde ao filtro'
              }
              description={
                articles.length === 0
                  ? 'Cada dúvida respondida duas vezes no atendimento é um artigo esperando para ser escrito.'
                  : 'Ajuste a busca, a categoria ou a situação para ver outros artigos.'
              }
              action={
                articles.length === 0 && categories.length > 0 ? (
                  <Button
                    size="sm"
                    icon={<Plus className="size-3.5" />}
                    onClick={() => {
                      setEditing(undefined);
                      setEditorOpen(true);
                    }}
                  >
                    Escrever o primeiro artigo
                  </Button>
                ) : null
              }
            />
          ) : (
            <ul className="overflow-hidden rounded-surface border border-line bg-surface divide-y divide-line-soft">
              {visible.map((article) => {
                const rate = helpfulRateOf(article);
                const category = categories.find((item) => item.id === article.categoryId);
                return (
                  <li
                    key={article.id}
                    className="flex items-start gap-3 p-3.5 transition-colors hover:bg-surface-2/60"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(article);
                            setEditorOpen(true);
                          }}
                          className="text-ui font-bold tracking-tight text-ink hover:text-brand"
                        >
                          {article.title}
                        </button>
                        <Badge tone={STATUS_TONE[article.status]} withDot>
                          {ARTICLE_STATUS_LABELS[article.status]}
                        </Badge>
                      </div>

                      {article.excerpt ? (
                        <p className="mt-0.5 line-clamp-1 text-body text-muted">
                          {article.excerpt}
                        </p>
                      ) : null}

                      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-dim">
                        {category ? <span>{category.name}</span> : null}
                        <span className="tabular-nums">
                          {article.views.toLocaleString('pt-BR')} leituras
                        </span>
                        {rate === undefined ? (
                          <span>sem votos</span>
                        ) : (
                          <span
                            className={cn(
                              'tabular-nums',
                              rate >= 80
                                ? 'text-green-text'
                                : rate >= 60
                                  ? 'text-amber-text'
                                  : 'text-red-text',
                            )}
                          >
                            {rate}% resolveu
                          </span>
                        )}
                        <span>atualizado em {article.updatedLabel}</span>
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Editar ${article.title}`}
                        onClick={() => {
                          setEditing(article);
                          setEditorOpen(true);
                        }}
                        className="rounded-control p-1.5 text-dim transition-colors hover:bg-surface-2 hover:text-ink"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Excluir ${article.title}`}
                        onClick={() => setDeletingArticle(article)}
                        className="rounded-control p-1.5 text-dim transition-colors hover:bg-red-soft hover:text-red-text"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Modal de Confirmação de Exclusão de Artigo */}
      <ConfirmModal
        open={deletingArticle !== null}
        title="Excluir artigo"
        description={
          <span>
            Tem certeza que deseja excluir o artigo{' '}
            <strong className="text-ink">&ldquo;{deletingArticle?.title}&rdquo;</strong>? Ele deixará de ser exibido na central de ajuda e nas respostas sugeridas.

          </span>
        }
        confirmLabel="Excluir artigo"
        variant="danger"
        onClose={() => setDeletingArticle(null)}
        onConfirm={handleConfirmDeleteArticle}
      />

      {/* Modal de Confirmação de Exclusão de Categoria */}
      <ConfirmModal
        open={deletingCategory !== null}
        title="Excluir categoria"
        description={
          <span>
            Tem certeza que deseja excluir a categoria{' '}
            <strong className="text-ink">{deletingCategory?.name}</strong>? Apenas categorias sem artigos vinculados podem ser excluídas.
          </span>
        }
        confirmLabel="Excluir categoria"
        variant="danger"
        onClose={() => setDeletingCategory(null)}
        onConfirm={handleConfirmDeleteCategory}
      />
    </div>
  );
}

function CategoryModal({
  state,
  onClose,
  onSaved,
}: {
  readonly state: { readonly mode: 'nova' } | { readonly mode: 'editar'; readonly category: KnowledgeCategory };
  readonly onClose: () => void;
  readonly onSaved: (category: KnowledgeCategory) => void;
}) {
  const existing = state.mode === 'editar' ? state.category : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const { show } = useToast();

  const handleSave = async () => {
    setError(undefined);
    setSaving(true);
    const result = await saveCategoryAction({
      ...(existing ? { id: existing.id } : {}),
      name: name.trim(),
      description: description.trim(),
    });
    setSaving(false);

    if (!result.ok) {
      setError(result.error ?? 'Não foi possível salvar a categoria.');
      return;
    }

    onSaved({
      id: existing?.id ?? `kc-novo-${Date.now()}`,
      accountId: existing?.accountId ?? '',
      name: name.trim(),
      description: description.trim(),
      order: existing?.order ?? 99,
    });
    show({ tone: 'sucesso', title: existing ? 'Categoria atualizada' : 'Categoria criada' });
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={existing ? 'Renomear categoria' : 'Nova categoria'}
      description="Categorias organizam o portal público — o cliente navega por elas antes de buscar."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={name.trim().length < 2 || saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Nome" htmlFor="category-name">
          <TextInput
            id="category-name"
            value={name}
            maxLength={60}
            placeholder="Pagamentos e faturas"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field
          label="Descrição"
          htmlFor="category-description"
          hint="Aparece abaixo do nome no portal. Opcional."
        >
          <TextArea
            id="category-description"
            rows={2}
            maxLength={160}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        {error ? (
          <p role="alert" className="text-meta font-medium text-red-text">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
