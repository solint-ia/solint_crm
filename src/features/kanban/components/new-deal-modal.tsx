'use client';

import { useState } from 'react';
import type { PipelineStage } from '@/core/domain/pipeline';

import { DEAL_SOURCES } from '@/core/domain/pipeline';
import { PRIORITIES } from '@/core/domain/conversation';
import { PRIORITY_LABEL } from '@/components/domain/presentation-maps';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';

interface NewDealModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly stages: readonly PipelineStage[];
  readonly initialStageId?: string;
  readonly owners: readonly string[];
  readonly onSubmit: (data: {
    title: string;
    valueInCents: number;
    stageId: string;
    contactName?: string;
    companyName?: string;
    ownerName?: string;
    priority?: 'baixa' | 'media' | 'alta' | 'urgente';
    probability?: number;
    source?: string;
    nextAction?: string;
  }) => Promise<void>;
}

export function NewDealModal({
  open,
  onClose,
  stages,
  initialStageId,
  owners,
  onSubmit,
}: NewDealModalProps) {
  const [title, setTitle] = useState('');
  const [valueStr, setValueStr] = useState('');
  const [stageId, setStageId] = useState(initialStageId ?? stages[0]?.id ?? '');
  const [contactName, setContactName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [ownerName, setOwnerName] = useState(owners[0] ?? '');
  const [priority, setPriority] = useState<'baixa' | 'media' | 'alta' | 'urgente'>('media');
  const [probability, setProbability] = useState('50');
  const [source, setSource] = useState('whatsapp');
  const [nextAction, setNextAction] = useState('Entrar em contato para qualificação');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        title: title.trim(),
        valueInCents: parsedValInCents,
        stageId: stageId || (stages[0]?.id ?? ''),
        contactName: contactName.trim() || undefined,
        companyName: companyName.trim() || undefined,
        ownerName: ownerName.trim() || undefined,
        priority,
        probability: parseInt(probability, 10) || 50,
        source,
        nextAction: nextAction.trim() || undefined,
      });
      // Reset form
      setTitle('');
      setValueStr('');
      setContactName('');
      setCompanyName('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar oportunidade.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova Oportunidade Comercial"
      description="Preencha os detalhes para registrar a oportunidade no funil de vendas."
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
            placeholder="Ex: Implantação CRM Enterprise - Empresa Alpha"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink placeholder:text-dim outline-none focus:border-brand focus:ring-1 focus:ring-brand/20"
          />
        </div>

        {/* Valor Estimado + Etapa Inicial */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-meta font-semibold text-ink">
              Valor estimado (R$)
            </label>
            <input
              type="text"
              placeholder="Ex: 15.000,00"
              value={valueStr}
              onChange={(e) => setValueStr(e.target.value)}
              className="w-full rounded-control border border-line bg-surface px-3 py-2 font-mono text-body text-ink placeholder:text-dim outline-none focus:border-brand focus:ring-1 focus:ring-brand/20"
            />
          </div>

          <div>
            <label className="mb-1 block text-meta font-semibold text-ink">Etapa Inicial</label>
            <select
              value={stageId}
              onChange={(e) => {
                setStageId(e.target.value);
                const st = stages.find((s) => s.id === e.target.value);
                if (st?.defaultProbability !== undefined) {
                  setProbability(String(st.defaultProbability));
                }
              }}
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

        {/* Contato Principal + Empresa */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-meta font-semibold text-ink">Contato Principal</label>
            <input
              type="text"
              placeholder="Nome do cliente ou tomador de decisão"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink placeholder:text-dim outline-none focus:border-brand"
            />
          </div>

          <div>
            <label className="mb-1 block text-meta font-semibold text-ink">Empresa / Razão Social</label>
            <input
              type="text"
              placeholder="Nome da empresa do cliente"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink placeholder:text-dim outline-none focus:border-brand"
            />
          </div>
        </div>

        {/* Vendedor + Prioridade + Probabilidade */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-meta font-semibold text-ink">Vendedor Responsável</label>
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

          <div>
            <label className="mb-1 block text-meta font-semibold text-ink flex items-center justify-between">
              <span>Probabilidade</span>
              <span className="text-brand text-micro font-bold">{probability}%</span>
            </label>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={probability}
              onChange={(e) => setProbability(e.target.value)}
              className="w-full accent-brand mt-2"
            />
          </div>
        </div>

        {/* Origem do Lead + Próxima Ação */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-meta font-semibold text-ink">Canal de Origem</label>
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
            <label className="mb-1 block text-meta font-semibold text-ink">Próxima Atividade</label>
            <input
              type="text"
              placeholder="Ex: Ligar para alinhar proposta"
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink placeholder:text-dim outline-none focus:border-brand"
            />
          </div>
        </div>

        {/* Rodapé do Modal */}
        <div className="mt-4 flex items-center justify-end gap-2.5 border-t border-line-soft pt-3">
          <Button variant="ghost" type="button" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={isSubmitting || !title.trim()}
            className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white"
          >
            {isSubmitting ? 'Salvando...' : 'Criar oportunidade'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
