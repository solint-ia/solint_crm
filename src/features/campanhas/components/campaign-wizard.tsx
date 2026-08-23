'use client';

import { useMemo, useState } from 'react';
import type { Segment, WhatsAppTemplate } from '@/core/domain/campaign';
import { renderTemplate } from '@/core/domain/campaign';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, TextInput } from '@/components/ui/field';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn';
import { WizardSteps } from './wizard-steps';
import { TemplatePreview } from './template-preview';
import { planned } from '@/components/ui/planned';

interface CampaignWizardProps {
  readonly segments: readonly Segment[];
  readonly templates: readonly WhatsAppTemplate[];
}

/** Wizard de 4 etapas com pre-visualizacao no estilo WhatsApp. */
export function CampaignWizard({ segments, templates }: CampaignWizardProps) {
  const [step, setStep] = useState(1);
  const [segmentId, setSegmentId] = useState(segments[0]?.id ?? '');
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [values, setValues] = useState<readonly string[]>([]);

  const segment = segments.find((item) => item.id === segmentId);
  const template = templates.find((item) => item.id === templateId);

  const preview = useMemo(
    () => (template ? renderTemplate(template.body, values) : ''),
    [template, values],
  );

  const setValue = (index: number, value: string) =>
    setValues((current) => {
      const next = [...current];
      next[index] = value;
      return next;
    });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div>
        <WizardSteps current={step} onSelect={setStep} />

        <Card>
          {step === 1 ? (
            <ul className="flex flex-col gap-2">
              {segments.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSegmentId(item.id)}
                    className={cn(
                      'w-full rounded-control border px-3 py-3 text-left transition-colors',
                      item.id === segmentId
                        ? 'border-brand bg-selected'
                        : 'border-line hover:bg-surface-2',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-ui font-semibold text-ink">{item.name}</span>
                      <Badge tone="blue">{formatNumber(item.contactCount)} contatos</Badge>
                    </span>
                    <span className="mt-0.5 block text-meta text-muted">
                      {item.description}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {step === 2 ? (
            <ul className="flex flex-col gap-2">
              {templates.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={item.approval !== 'aprovado'}
                    onClick={() => setTemplateId(item.id)}
                    className={cn(
                      'w-full rounded-control border px-3 py-3 text-left transition-colors disabled:opacity-50',
                      item.id === templateId
                        ? 'border-brand bg-selected'
                        : 'border-line hover:bg-surface-2',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-mono text-body text-ink">{item.name}</span>
                      <Badge tone={item.approval === 'aprovado' ? 'green' : 'amber'}>
                        {item.approval === 'aprovado' ? 'Aprovado' : 'Em analise'}
                      </Badge>
                    </span>
                    <span className="mt-1 block text-meta text-muted">{item.body}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {step === 3 ? (
            <div className="flex flex-col gap-3">
              {template?.variables.map((variable, index) => (
                <Field key={variable} label={`Variável ${index + 1} · ${variable}`}>
                  <TextInput
                    value={values[index] ?? ''}
                    onChange={(event) => setValue(index, event.target.value)}
                    placeholder={variable}
                  />
                </Field>
              ))}
              {template && template.variables.length === 0 ? (
                <p className="text-body text-muted">Este template não possui variáveis.</p>
              ) : null}
            </div>
          ) : null}

          {step === 4 ? (
            <div className="flex flex-col gap-3">
              <Field label="Data e hora do disparo" htmlFor="scheduled-at">
                <TextInput id="scheduled-at" type="datetime-local" />
              </Field>
              <Field
                label="Limite de envios por minuto"
                htmlFor="rate-limit"
                hint="Respeite os limites da sua conta no WhatsApp para evitar bloqueios."
              >
                <TextInput id="rate-limit" type="number" defaultValue={60} min={1} max={600} />
              </Field>
            </div>
          ) : null}

          <div className="mt-4 flex justify-between border-t border-line pt-3">
            <Button
              variant="secondary"
              size="sm"
              disabled={step === 1}
              onClick={() => setStep((current) => Math.max(1, current - 1))}
            >
              Voltar
            </Button>
            {step < 4 ? (
              <Button size="sm" onClick={() => setStep((current) => Math.min(4, current + 1))}>
                Continuar
              </Button>
            ) : (
              <Button size="sm" variant="gradient" {...planned('Agendar o disparo da campanha')}>
                Agendar disparo
              </Button>
            )}
          </div>
        </Card>
      </div>

      <TemplatePreview
        preview={preview}
        segmentName={segment?.name}
        recipients={segment?.contactCount}
        templateName={template?.name}
      />
    </div>
  );
}
