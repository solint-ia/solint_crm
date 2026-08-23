'use client';

import { useMemo, useState } from 'react';
import { Eye, Pencil, X } from 'lucide-react';
import type { ArticleStatus, KnowledgeArticle, KnowledgeCategory } from '@/core/domain/knowledge';
import { ARTICLE_STATUS_LABELS, ARTICLE_STATUSES, slugify } from '@/core/domain/knowledge';
import { Button } from '@/components/ui/button';
import { Field, Select, TextArea, TextInput } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/cn';

export interface ArticleDraftInput {
  readonly id?: string;
  readonly categoryId: string;
  readonly title: string;
  readonly excerpt: string;
  readonly content: string;
  readonly status: ArticleStatus;
  readonly tags: readonly string[];
}

interface ArticleEditorProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSave: (draft: ArticleDraftInput) => Promise<{ ok: boolean; error?: string }>;
  readonly categories: readonly KnowledgeCategory[];
  readonly editing?: KnowledgeArticle;
  readonly defaultCategoryId?: string;
}

export function ArticleEditor({
  open,
  onClose,
  onSave,
  categories,
  editing,
  defaultCategoryId,
}: ArticleEditorProps) {
  const [tab, setTab] = useState<'editar' | 'previa'>('editar');
  const [title, setTitle] = useState(editing?.title ?? '');
  const [categoryId, setCategoryId] = useState(
    editing?.categoryId ?? defaultCategoryId ?? categories[0]?.id ?? '',
  );
  const [excerpt, setExcerpt] = useState(editing?.excerpt ?? '');
  const [content, setContent] = useState(editing?.content ?? '');
  const [status, setStatus] = useState<ArticleStatus>(editing?.status ?? 'rascunho');
  const [tagText, setTagText] = useState(editing?.tags.join(', ') ?? '');
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const tags = useMemo(
    () =>
      tagText
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 10),
    [tagText],
  );

  const slug = useMemo(() => slugify(title), [title]);
  const categoryName = categories.find((category) => category.id === categoryId)?.name ?? '';
  const incomplete = title.trim().length < 3 || content.trim().length < 10 || !categoryId;

  const handleSave = async () => {
    setError(undefined);
    setSaving(true);
    const result = await onSave({
      ...(editing ? { id: editing.id } : {}),
      categoryId,
      title: title.trim(),
      excerpt: excerpt.trim(),
      content: content.trim(),
      status,
      tags,
    });
    setSaving(false);
    if (result.ok) onClose();
    else setError(result.error ?? 'Não foi possível salvar o artigo.');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Editar artigo' : 'Novo artigo'}
      description={
        editing
          ? `Última atualização em ${editing.updatedLabel}, por ${editing.authorName}.`
          : 'O artigo só aparece no portal depois de publicado.'
      }
      className="max-w-3xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={incomplete || saving}>
            {saving ? 'Salvando…' : status === 'publicado' ? 'Salvar e publicar' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="inline-flex gap-1 self-start rounded-control bg-surface-2 p-1">
          {(
            [
              { id: 'editar', label: 'Editar', icon: Pencil },
              { id: 'previa', label: 'Ver como cliente', icon: Eye },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setTab(option.id)}
              aria-pressed={tab === option.id}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-control px-3 py-1.5 text-body font-semibold transition-colors',
                tab === option.id ? 'bg-surface text-brand shadow-xs' : 'text-muted hover:text-ink',
              )}
            >
              <option.icon className="size-3.5" />
              {option.label}
            </button>
          ))}
        </div>

        {tab === 'editar' ? (
          <>
            <Field label="Título" htmlFor="article-title">
              <TextInput
                id="article-title"
                value={title}
                maxLength={140}
                placeholder="Como rastrear meu pedido"
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>

            {slug ? (
              <p className="-mt-2 font-mono text-micro text-dim">
                /ajuda/{categoryName ? `${slugify(categoryName)}/` : ''}
                {slug}
              </p>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Categoria" htmlFor="article-category">
                <Select
                  id="article-category"
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                >
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Situação"
                htmlFor="article-status"
                hint={
                  status === 'publicado'
                    ? 'Visível no portal público e para os agentes.'
                    : status === 'rascunho'
                      ? 'Só a equipe vê. Não aparece na busca do cliente.'
                      : 'Fora do portal, mas preservado no histórico.'
                }
              >
                <Select
                  id="article-status"
                  value={status}
                  onChange={(event) => setStatus(event.target.value as ArticleStatus)}
                >
                  {ARTICLE_STATUSES.map((option) => (
                    <option key={option} value={option}>
                      {ARTICLE_STATUS_LABELS[option]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field
              label="Resumo"
              htmlFor="article-excerpt"
              hint="Uma linha. É o que aparece na lista de resultados da busca."
            >
              <TextArea
                id="article-excerpt"
                rows={2}
                maxLength={240}
                value={excerpt}
                onChange={(event) => setExcerpt(event.target.value)}
              />
            </Field>

            <Field label="Conteúdo" htmlFor="article-content">
              <TextArea
                id="article-content"
                rows={10}
                maxLength={20000}
                value={content}
                placeholder="Escreva a resposta completa, do jeito que o cliente precisa ler."
                onChange={(event) => setContent(event.target.value)}
              />
            </Field>

            <Field
              label="Etiquetas"
              htmlFor="article-tags"
              hint="Separadas por vírgula. Entram na busca junto com o texto."
            >
              <TextInput
                id="article-tags"
                value={tagText}
                placeholder="entrega, rastreio, prazo"
                onChange={(event) => setTagText(event.target.value)}
              />
            </Field>

            {tags.length > 0 ? (
              <div className="-mt-2 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-control bg-surface-2 px-2 py-0.5 text-micro font-semibold text-muted"
                  >
                    {tag}
                    <button
                      type="button"
                      aria-label={`Remover etiqueta ${tag}`}
                      onClick={() =>
                        setTagText(tags.filter((item) => item !== tag).join(', '))
                      }
                      className="text-dim hover:text-red-text"
                    >
                      <X className="size-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          /* Prévia do portal: mesma tipografia de leitura que o cliente vê. */
          <article className="rounded-surface border border-line bg-app px-6 py-5">
            <p className="text-micro font-semibold tracking-wide text-brand uppercase">
              {categoryName || 'Sem categoria'}
            </p>
            <h1 className="mt-1 font-display text-display leading-tight font-bold tracking-tight text-ink">
              {title || 'Título do artigo'}
            </h1>
            {excerpt ? <p className="mt-2 text-ui text-muted">{excerpt}</p> : null}
            <div className="mt-4 max-w-[65ch] border-t border-line pt-4 text-ui leading-relaxed whitespace-pre-wrap text-ink">
              {content || 'O conteúdo do artigo aparece aqui.'}
            </div>
            <footer className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <span className="text-body text-muted">Isto resolveu sua dúvida?</span>
              <span className="rounded-control border border-line px-2.5 py-1 text-body font-semibold text-dim">
                Sim
              </span>
              <span className="rounded-control border border-line px-2.5 py-1 text-body font-semibold text-dim">
                Não
              </span>
            </footer>
          </article>
        )}

        {error ? (
          <p role="alert" className="text-meta font-medium text-red-text">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
