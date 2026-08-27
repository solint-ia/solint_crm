'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { createAiAgentAction } from '@/app/(workspace)/agentes-ia/actions';

const SCOPE_SUGGESTIONS = [
  'Triagem e Qualificação de Leads',
  'Suporte Técnico e Resolução N1',
  'Atendimento e Dúvidas Gerais',
  'Cobrança e Pós-Venda',
];

export function CreateAgentButton() {
  const router = useRouter();
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);

  const [name, setName] = useState('');
  const [scope, setScope] = useState('');
  const [persona, setPersona] = useState('');
  const [model, setModel] = useState('gemini-1.5-flash');
  const [error, setError] = useState<string | null>(null);

  const handleOpen = () => {
    setName('');
    setScope('');
    setPersona('Assistente amigável, clara e prestativa que ajuda os clientes da empresa com rapidez e cordialidade.');
    setModel('gemini-1.5-flash');
    setError(null);
    setIsOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !scope.trim() || !persona.trim()) return;

    setError(null);
    startTransition(async () => {
      const res = await createAiAgentAction({
        name: name.trim(),
        scope: scope.trim(),
        persona: persona.trim(),
        model,
      });

      if (!res.ok || !res.agent) {
        setError(res.error ?? 'Erro ao criar agente de IA.');
        return;
      }

      show({
        tone: 'sucesso',
        title: 'Agente de IA criado',
        description: `${res.agent.name} foi criado e está pronto para configuração.`,
      });

      setIsOpen(false);
      router.push(`/agentes-ia/${res.agent.id}`);
      router.refresh();
    });
  };

  return (
    <>
      <Button
        size="md"
        icon={<Plus className="size-4" />}
        onClick={handleOpen}
      >
        Novo agente
      </Button>

      <Modal
        open={isOpen}
        onClose={() => setIsOpen(false)}
        title="Novo Agente de IA"
        description="Crie um novo assistente virtual com persona própria e modelo de linguagem dedicado."
        className="max-w-lg"
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-1">
          {error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
              {error}
            </div>
          ) : null}

          <div>
            <label htmlFor="agent-name" className="mb-1 block text-xs font-semibold text-ink">
              Nome do agente
            </label>
            <input
              id="agent-name"
              type="text"
              required
              placeholder="Ex: Clara - Vendas, Alex - Suporte N1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="agent-scope" className="text-xs font-semibold text-ink">
                Escopo de atuação
              </label>
              <span className="text-[11px] text-dim">Sugestões rápidas:</span>
            </div>

            <div className="mb-2 flex flex-wrap gap-1.5">
              {SCOPE_SUGGESTIONS.map((sug) => (
                <button
                  type="button"
                  key={sug}
                  onClick={() => setScope(sug)}
                  className="rounded-lg border border-line bg-surface-2 px-2 py-0.5 text-[10px] text-muted hover:border-brand hover:text-brand transition-colors"
                >
                  {sug}
                </button>
              ))}
            </div>

            <input
              id="agent-scope"
              type="text"
              required
              placeholder="Ex: Qualificação de novos leads no WhatsApp"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
            />
          </div>

          <div>
            <label htmlFor="agent-model" className="mb-1 block text-xs font-semibold text-ink">
              Modelo de IA
            </label>
            <select
              id="agent-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand shadow-2xs"
            >
              <option value="gemini-1.5-flash">Google Gemini 1.5 Flash (Recomendado - Rápido e Eficiente)</option>
              <option value="gemini-1.5-pro">Google Gemini 1.5 Pro (Raciocínio Profundo e Complexo)</option>
              <option value="gpt-4o-mini">OpenAI GPT-4o Mini (Equilibrado)</option>
              <option value="gpt-4o">OpenAI GPT-4o (Alta Capacidade)</option>
            </select>
          </div>

          <div>
            <label htmlFor="agent-persona" className="mb-1 block text-xs font-semibold text-ink">
              Persona e tom de voz
            </label>
            <textarea
              id="agent-persona"
              rows={3}
              required
              placeholder="Descreva como o agente deve se apresentar e falar com os clientes..."
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              className="w-full rounded-xl border border-line bg-surface p-3 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs leading-relaxed"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isPending || !name.trim() || !scope.trim() || !persona.trim()}
            >
              {isPending ? 'Criando agente…' : 'Criar agente'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
