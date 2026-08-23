'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import type { WhatsAppTemplate } from '@/core/domain/campaign';
import { renderTemplate } from '@/core/domain/campaign';
import { Button } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/cn';

interface TemplatePickerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly templates: readonly WhatsAppTemplate[];
  readonly contactName: string;
  readonly pending?: boolean;
  readonly onSend: (templateId: string, values: readonly string[]) => void;
}

const APPROVAL = {
  aprovado: { icon: CheckCircle2, label: 'Aprovado', tone: 'text-green-text' },
  em_analise: { icon: Clock, label: 'Em análise', tone: 'text-amber-text' },
  rejeitado: { icon: XCircle, label: 'Rejeitado', tone: 'text-red-text' },
} as const;

/**
 * Seletor de template HSM.
 *
 * O banner de janela fechada mandava "envie um template aprovado" e não oferecia
 * nenhum: era um beco sem saída, o pior defeito da tela de conversas. Aqui o
 * agente escolhe, preenche as variáveis e vê o texto final antes de enviar —
 * um template disparado com `{{1}}` visível chega assim no cliente.
 *
 * Templates não aprovados aparecem na lista, desabilitados. Escondê-los faria
 * o agente procurar um template que ele sabe que existe e não achar.
 */
export function TemplatePicker({
  open,
  onClose,
  templates,
  contactName,
  pending,
  onSend,
}: TemplatePickerProps) {
  const approved = templates.filter((template) => template.approval === 'aprovado');
  const [selectedId, setSelectedId] = useState(approved[0]?.id ?? '');
  const [values, setValues] = useState<readonly string[]>([]);

  const selected = templates.find((template) => template.id === selectedId);
  const preview = useMemo(
    () => (selected ? renderTemplate(selected.body, values) : ''),
    [selected, values],
  );

  const missing = selected
    ? selected.variables.some((_, index) => !values[index]?.trim())
    : true;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Enviar template aprovado"
      description={`A janela de 24h com ${contactName} está fechada. Só um template reabre a conversa.`}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!selected || selected.approval !== 'aprovado' || missing || pending}
            onClick={() => selected && onSend(selected.id, values)}
          >
            {pending ? 'Enviando…' : 'Enviar template'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ul className="max-h-52 overflow-y-auto rounded-control border border-line divide-y divide-line-soft">
          {templates.map((template) => {
            const meta = APPROVAL[template.approval];
            const Icon = meta.icon;
            const usable = template.approval === 'aprovado';
            return (
              <li key={template.id}>
                <button
                  type="button"
                  disabled={!usable}
                  onClick={() => {
                    setSelectedId(template.id);
                    setValues([]);
                  }}
                  aria-current={template.id === selectedId ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors',
                    template.id === selectedId ? 'bg-selected' : 'hover:bg-surface-2',
                    !usable && 'cursor-not-allowed opacity-55 hover:bg-transparent',
                  )}
                >
                  <Icon className={cn('mt-0.5 size-3.5 shrink-0', meta.tone)} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-body font-semibold text-ink">
                      {template.name}
                    </span>
                    <span className="line-clamp-1 block text-meta text-muted">
                      {template.body}
                    </span>
                  </span>
                  <span className={cn('shrink-0 text-micro font-semibold', meta.tone)}>
                    {meta.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {selected && selected.variables.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {selected.variables.map((variable, index) => (
              <Field
                key={variable}
                label={variable}
                htmlFor={`template-var-${index}`}
                hint={`Substitui {{${index + 1}}}`}
              >
                <TextInput
                  id={`template-var-${index}`}
                  value={values[index] ?? ''}
                  maxLength={300}
                  onChange={(event) =>
                    setValues((current) => {
                      const next = [...current];
                      next[index] = event.target.value;
                      return next;
                    })
                  }
                />
              </Field>
            ))}
          </div>
        ) : null}

        {selected ? (
          <div className="rounded-control border border-line bg-surface-2 px-3.5 py-3">
            <p className="text-micro font-semibold tracking-wide text-dim uppercase">
              O cliente vai receber
            </p>
            <p className="mt-1.5 text-ui leading-relaxed whitespace-pre-wrap text-ink">
              {preview}
            </p>
          </div>
        ) : null}

        {approved.length === 0 ? (
          <p className="text-meta text-amber-text">
            Nenhum template aprovado nesta conta. Sem um, não há como reabrir uma conversa fora da
            janela de 24h.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
