'use client';

import { useEffect, useState } from 'react';
import type { Deal, PipelineStage } from '@/core/domain/pipeline';
import { DEAL_SOURCES } from '@/core/domain/pipeline';
import { PRIORITIES } from '@/core/domain/conversation';
import { PRIORITY_LABEL } from '@/components/domain/presentation-maps';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';

interface EditDealModalProps {
  readonly open: boolean;
  readonly deal: Deal | null;
  readonly stages: readonly PipelineStage[];
  readonly owners: readonly string[];
  readonly onClose: () => void;
  readonly onSubmit: (data: {
    dealId: string;
    title: string;
    valueInCents: number;
    stageId: string;
    contactName?: string;
    companyName?: string;
    ownerName?: string;
    priority?: 'baixa' | 'media' | 'alta' | 'urgente';
    source?: string;
    nextAction?: string;
  }) => Promise<void>;
}

export function EditDealModal({
  open,
  deal,
  stages,
  owners,
  onClose,
  onSubmit,
}: EditDealModalProps) {
  const [title, setTitle] = useState('');
  const [valueStr, setValueStr] = useState('');
  const [stageId, setStageId] = useState('');
  const [contactName, setContactName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [priority, setPriority] = useState<'baixa' | 'media' | 'alta' | 'urgente'>('media');
  const [source, setSource] = useState('whatsapp');
  const [nextAction, setNextAction] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (deal) {
      setTitle(deal.title ?? deal.contactName);
      setValueStr((deal.amountInCents / 100).toFixed(2).replace('.', ','));
      setStageId(deal.stageId);
      setContactName(deal.contactName);
      setCompanyName(deal.company ?? '');
      setOwnerName(deal.ownerName);
      setPriority(deal.priority);
      setSource(deal.source ?? 'whatsapp');
      setNextAction(deal.nextAction ?? '');
    }
  }, [deal]);

  if (!deal) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError('Informe o título da oportunidade.');
      return;
    }

    const cleanVal = valueStr.replace(/[^\d.,]/g, '').replace(',', '.');
    const parsedValInCents = Math.round((parseFloat(cleanVal) || 0) * 100);

    setIsSubmitting(true);
    try {
      await onSubmit({
        dealId: deal.id,
        title: title.trim(),
        valueInCents: parsedValInCents,
        stageId,
        contactName: contactName.trim() || undefined,
        companyName: companyName.trim() || undefined,
        ownerName: ownerName.trim() || undefined,
        priority,
        source,
        nextAction: nextAction.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar oportunidade.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Editar Oportunidade"
      description="Atualize as informações comerciais desta oportunidade."
      className="max-w-xl"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && (
          <div className="rounded-md bg-red-soft p-3 text-body text-red-text border border-red-line/50">
            {error}
          </div>
        )}

        {/* Título da Oportunidade */}
        <div>
          <label className="mb-1 block text-meta font-semibold text-ink">
            Título da oportunidade <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink outline-none focus:border-brand"
          />
        </div>

        {/* Valor Estimado + Etapa */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-meta font-semibold text-ink">
              Valor estimado (R$)
            </label>
            <input
              type="text"
              value={valueStr}
              onChange={(e) => setValueStr(e.target.value)}
              className="w-full rounded-control border border-line bg-surface px-3 py-2 font-mono text-body text-ink outline-none focus:border-brand"
            />
          </div>

          <div>
            <label className="mb-1 block text-meta font-semibold text-ink">Etapa do Funil</label>
            <select
              value={stageId}
              onChange={(e) => setStageId(e.target.value)}
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink outline-none focus:border-brand"
            >
              {stages.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Contato + Empresa */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-meta font-semibold text-ink">Contato Principal</label>
            <input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink outline-none focus:border-brand"
            />
          </div>

          <div>
            <label className="mb-1 block text-meta font-semibold text-ink">Empresa</label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink outline-none focus:border-brand"
            />
          </div>
        </div>

        {/* Vendedor + Prioridade */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-meta font-semibold text-ink">Responsável</label>
            <select
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink outline-none focus:border-brand"
            >
              {owners.map((owner) => (
                <option key={owner} value={owner}>
                  {owner}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-meta font-semibold text-ink">Prioridade</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as typeof priority)}
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink outline-none focus:border-brand"
            >
              {PRIORITIES.map((prio) => (
                <option key={prio} value={prio}>
                  {PRIORITY_LABEL[prio]}
                </option>
              ))}
            </select>
          </div>

        </div>

        {/* Origem + Próxima Ação */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-meta font-semibold text-ink">Origem</label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink outline-none focus:border-brand"
            >
              {DEAL_SOURCES.map((src) => (
                <option key={src.id} value={src.id}>
                  {src.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-meta font-semibold text-ink">Próxima Ação</label>
            <input
              type="text"
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink outline-none focus:border-brand"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2.5 border-t border-line-soft pt-3">
          <Button variant="ghost" type="button" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? 'Salvando...' : 'Salvar alterações'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
