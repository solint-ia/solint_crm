'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlignLeft,
  Calendar,
  CheckSquare,
  DollarSign,
  Globe,
  Hash,
  List,
  MessageSquare,
  Plus,
  Sliders,
  Trash2,
  User,
} from 'lucide-react';
import type { CustomAttributeDefinition } from '@/core/domain/settings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import {
  createCustomAttributeAction,
  deleteCustomAttributeAction,
} from '@/app/(workspace)/configuracoes/actions';
import { cn } from '@/lib/cn';

interface CustomAttributesSectionProps {
  readonly attributes: readonly CustomAttributeDefinition[];
}

type EntityType = 'contato' | 'conversa';

const ENTITY_TABS: readonly { readonly id: EntityType; readonly label: string; readonly icon: React.ElementType }[] = [
  { id: 'contato', label: 'Contatos', icon: User },
  { id: 'conversa', label: 'Conversas', icon: MessageSquare },
];

const TYPE_ICONS: Record<string, React.ElementType> = {
  texto: AlignLeft,
  numero: Hash,
  data: Calendar,
  lista: List,
  checkbox: CheckSquare,
  moeda: DollarSign,
  url: Globe,
};

export function CustomAttributesSection({ attributes }: CustomAttributesSectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeEntity, setActiveEntity] = useState<EntityType>('contato');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deletingAttribute, setDeletingAttribute] = useState<CustomAttributeDefinition | null>(null);

  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [type, setType] = useState<CustomAttributeDefinition['type']>('texto');
  const [appliesTo, setAppliesTo] = useState<CustomAttributeDefinition['appliesTo']>('contato');
  const [error, setError] = useState<string | null>(null);

  const filteredAttributes = useMemo(() => {
    return attributes.filter((attr) => attr.appliesTo === activeEntity);
  }, [attributes, activeEntity]);

  const handleOpenNew = (defaultEntity?: EntityType) => {
    setName('');
    setKey('');
    setType('texto');
    setAppliesTo(defaultEntity ?? activeEntity);
    setError(null);
    setIsModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createCustomAttributeAction({
        name,
        key: key.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
        type,
        appliesTo,
      });
      if (res.ok) {
        setIsModalOpen(false);
        setName('');
        setKey('');
        router.refresh();
      } else {
        setError(res.error ?? 'Erro ao salvar atributo.');
      }
    });
  };

  const handleConfirmDelete = async () => {
    if (!deletingAttribute) return;
    startTransition(async () => {
      await deleteCustomAttributeAction({ attributeId: deletingAttribute.id });
      setDeletingAttribute(null);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-200">
      {/* ============================================================ */}
      {/* CABEÇALHO                                                    */}
      {/* ============================================================ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-bold tracking-tight text-ink">
              Atributos personalizados
            </h2>
            <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
              {attributes.length} campos ativos
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">
            Configure campos adicionais para registrar dados específicos de cada entidade do seu negócio.
          </p>
        </div>

        <Button
          size="md"
          icon={<Plus className="size-4" />}
          onClick={() => handleOpenNew()}
        >
          Novo atributo
        </Button>
      </div>

      {/* ============================================================ */}
      {/* ABAS POR ENTIDADE ESTILO DASHBOARD                           */}
      {/* ============================================================ */}
      <div className="flex items-center gap-1 rounded-2xl border border-line bg-surface-2 p-1 text-xs overflow-x-auto w-fit">
        {ENTITY_TABS.map((tab) => {
          const active = activeEntity === tab.id;
          const Icon = tab.icon;
          const count = attributes.filter((a) => a.appliesTo === tab.id).length;
          return (
            <button
              type="button"
              key={tab.id}
              onClick={() => setActiveEntity(tab.id)}
              className={cn(
                'flex items-center gap-2 rounded-xl px-3.5 py-1.5 font-semibold transition-all whitespace-nowrap',
                active
                  ? 'bg-surface text-ink shadow-2xs font-bold ring-1 ring-black/5 dark:ring-white/10'
                  : 'text-muted hover:text-ink',
              )}
            >
              <Icon className={cn('size-3.5', active ? 'text-blue-600 dark:text-blue-400' : 'text-dim')} />
              <span>{tab.label}</span>
              <span
                className={cn(
                  'rounded-md px-1.5 py-0.2 text-[10px] font-mono tabular-nums',
                  active ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400' : 'bg-surface text-dim',
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ============================================================ */}
      {/* LISTAGEM DE ATRIBUTOS                                         */}
      {/* ============================================================ */}
      {filteredAttributes.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface-2/40 p-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-dim mb-3">
            <Sliders className="size-6" />
          </div>
          <h4 className="font-display text-base font-bold text-ink">
            Nenhum atributo cadastrado para esta entidade
          </h4>
          <p className="mt-1 max-w-sm text-xs text-muted">
            Adicione campos personalizados para enriquecer o cadastro e as fichas de atendimento.
          </p>
          <Button
            size="md"
            className="mt-5"
            icon={<Plus className="size-4" />}
            onClick={() => handleOpenNew()}
          >
            Adicionar primeiro campo
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-2xs">
          <div className="divide-y divide-line-soft">
            {filteredAttributes.map((attr) => {
              const TypeIcon = TYPE_ICONS[attr.type] || AlignLeft;
              return (
                <div
                  key={attr.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between transition-colors hover:bg-surface-2/50"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 border border-line-soft text-muted">
                      <TypeIcon className="size-4 text-dim" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-ink truncate">
                          {attr.name}
                        </span>
                        <Badge tone="blue">
                          {attr.type}
                        </Badge>
                      </div>
                      <span className="font-mono text-xs text-dim block mt-0.5">
                        {attr.key}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <span className="text-xs text-dim">
                      Visível nos detalhes
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Excluir atributo ${attr.name}`}
                      onClick={() => setDeletingAttribute(attr)}
                      icon={<Trash2 className="size-3.5 text-red-500" />}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modal Criar Atributo */}
      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Novo atributo personalizado"
        description="Defina o nome de exibição, a chave técnica da API e o formato dos dados."
        className="max-w-md"
      >
        <form onSubmit={handleSave} className="flex flex-col gap-4 pt-1">
          {error ? (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}

          <div>
            <label htmlFor="attr-name" className="mb-1 block text-xs font-semibold text-ink">
              Nome de exibição do atributo
            </label>
            <input
              id="attr-name"
              type="text"
              required
              placeholder="Ex: CPF, Código de Rastreio, Limite de Crédito"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!key) {
                  setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
                }
              }}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
            />
          </div>

          <div>
            <label htmlFor="attr-key" className="mb-1 block text-xs font-semibold text-ink">
              Chave técnica (API e Webhooks)
            </label>
            <input
              id="attr-key"
              type="text"
              required
              placeholder="ex: cpf, codigo_rastreio"
              value={key}
              onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 font-mono text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="attr-type" className="mb-1 block text-xs font-semibold text-ink">
                Tipo do dado
              </label>
              <select
                id="attr-type"
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
                className="h-10 w-full rounded-xl border border-line bg-surface px-2.5 text-xs text-ink outline-none focus:border-brand shadow-2xs"
              >
                <option value="texto">Texto</option>
                <option value="numero">Número</option>
                <option value="data">Data</option>
                <option value="lista">Lista de opções</option>
                <option value="checkbox">Checkbox (Sim/Não)</option>
              </select>
            </div>

            <div>
              <label htmlFor="attr-entity" className="mb-1 block text-xs font-semibold text-ink">
                Vincular à entidade
              </label>
              <select
                id="attr-entity"
                value={appliesTo}
                onChange={(e) => setAppliesTo(e.target.value as typeof appliesTo)}
                className="h-10 w-full rounded-xl border border-line bg-surface px-2.5 text-xs text-ink outline-none focus:border-brand shadow-2xs"
              >
                <option value="contato">Contato</option>
                <option value="conversa">Conversa</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || !name.trim() || !key.trim()}>
              {isPending ? 'Salvando…' : 'Criar atributo'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Confirmação de Exclusão */}
      <ConfirmModal
        open={deletingAttribute !== null}
        title="Excluir atributo personalizado"
        description={
          <span>
            Tem certeza que deseja excluir o campo{' '}
            <strong className="text-ink">{deletingAttribute?.name}</strong>? Os valores já salvos nos cadastros existentes não serão mais exibidos na interface.
          </span>
        }
        confirmLabel="Excluir atributo"
        variant="danger"
        isLoading={isPending}
        onClose={() => setDeletingAttribute(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
