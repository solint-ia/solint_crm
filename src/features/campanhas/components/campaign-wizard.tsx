'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
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
import { createCampaignAction } from '@/app/(workspace)/campanhas/actions';

interface CampaignWizardProps {
  readonly segments: readonly Segment[];
  readonly templates: readonly WhatsAppTemplate[];
}

/** Wizard de 4 etapas com pre-visualizacao no estilo WhatsApp. */
export function CampaignWizard({ segments, templates }: CampaignWizardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState(1);
  const [campaignName, setCampaignName] = useState('');
  const [segmentId, setSegmentId] = useState(segments[0]?.id ?? '');
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [values, setValues] = useState<readonly string[]>([]);
  const [scheduledAt, setScheduledAt] = useState('');
  const [rateLimit, setRateLimit] = useState(60);
  const [error, setError] = useState<string | null>(null);

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

  const handleFinish = () => {
    setError(null);
    const finalName = campaignName.trim() || `Campanha ${template?.name ?? 'WhatsApp'} · ${new Date().toLocaleDateString('pt-BR')}`;

    startTransition(async () => {
      const res = await createCampaignAction({
        name: finalName,
        segmentId: segmentId || undefined,
        templateId,
        scheduledAt: scheduledAt || undefined,
        rateLimit,
        variables: values,
      });

      if (res.ok) {
        router.push('/campanhas');
      } else {
        setError(res.error ?? 'Erro ao criar campanha.');
      }
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div>
        <WizardSteps current={step} onSelect={setStep} />

        {error && (
          <div className="mb-4 rounded-md bg-danger/10 p-3 text-body text-danger">
            {error}
          </div>
        )}

        <Card>
          {step === 1 ? (
            <div className="flex flex-col gap-4">
              <Field label="Nome da campanha (opcional)" htmlFor="campaign-name">
                <TextInput
                  id="campaign-name"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  placeholder="Ex: Reativação Clientes Q3"
                />
              </Field>

              <div>
                <label className="mb-2 block text-meta font-semibold text-ink">Selecione o público-alvo</label>
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
              </div>
            </div>
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
              <Field label="Data e hora do disparo (deixe vazio para envio imediato)" htmlFor="scheduled-at">
                <TextInput
                  id="scheduled-at"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </Field>
              <Field
                label="Limite de envios por minuto"
                htmlFor="rate-limit"
                hint="Respeite os limites da sua conta no WhatsApp para evitar bloqueios."
              >
                <TextInput
                  id="rate-limit"
                  type="number"
                  value={rateLimit}
                  onChange={(e) => setRateLimit(parseInt(e.target.value, 10) || 60)}
                  min={1}
                  max={600}
                />
              </Field>
            </div>
          ) : null}

          <div className="mt-4 flex justify-between border-t border-line pt-3">
            <Button
              variant="secondary"
              size="sm"
              disabled={step === 1 || isPending}
              onClick={() => setStep((current) => Math.max(1, current - 1))}
            >
              Voltar
            </Button>
            {step < 4 ? (
              <Button size="sm" onClick={() => setStep((current) => Math.min(4, current + 1))}>
                Continuar
              </Button>
            ) : (
              <Button size="sm" variant="gradient" disabled={isPending} onClick={handleFinish}>
                {isPending ? 'Criando...' : scheduledAt ? 'Agendar disparo' : 'Iniciar disparo agora'}
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

