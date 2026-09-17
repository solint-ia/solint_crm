'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import type {
  CampaignAudienceOption,
  CampaignContactField,
  CampaignInbox,
  CampaignVariable,
  WhatsAppTemplate,
} from '@/core/domain/campaign';
import {
  CAMPAIGN_CONTACT_FIELD_LABELS,
  renderTemplate,
  resolveCampaignVariables,
  templateVariableCount,
} from '@/core/domain/campaign';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Select, TextInput } from '@/components/ui/field';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn';
import { WizardSteps } from './wizard-steps';
import { TemplatePreview } from './template-preview';
import { createCampaignAction } from '@/app/(workspace)/campanhas/actions';

interface CampaignWizardProps {
  readonly inboxes: readonly CampaignInbox[];
  readonly audiences: readonly CampaignAudienceOption[];
  /** Só aprovados, já filtrados pelas WABAs das caixas oficiais. */
  readonly templates: readonly WhatsAppTemplate[];
}

const CAMPOS: readonly CampaignContactField[] = ['nome', 'primeiro_nome', 'empresa', 'telefone'];

/** Contato de exemplo para a prévia das variáveis mapeadas. */
const EXEMPLO = { name: 'Maria Silva', phone: '+55 11 99999-0000', company: 'Empresa Exemplo' };

/**
 * Assistente de campanha em quatro passos.
 *
 * A caixa vem primeiro porque decide o resto: o template precisa ser da mesma
 * conta do WhatsApp Business, e o número é o que o cliente vê. O público vem
 * depois do template porque a prévia com as variáveis já preenchidas é o que
 * faz alguém perceber que "{{1}}" era o nome, não a oferta.
 */
export function CampaignWizard({ inboxes, audiences, templates }: CampaignWizardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const conectadas = inboxes.filter((inbox) => inbox.connected);
  const [inboxId, setInboxId] = useState(conectadas[0]?.id ?? inboxes[0]?.id ?? '');
  const [templateId, setTemplateId] = useState('');
  const [variables, setVariables] = useState<readonly CampaignVariable[]>([]);
  const [audienceIndex, setAudienceIndex] = useState(0);
  const [scheduledAt, setScheduledAt] = useState('');
  const [rateLimit, setRateLimit] = useState(30);
  const [error, setError] = useState<string | null>(null);

  const inbox = inboxes.find((item) => item.id === inboxId);
  const templatesDaCaixa = useMemo(
    () => (inbox ? templates.filter((t) => t.wabaId === inbox.wabaId) : []),
    [inbox, templates],
  );
  const template =
    templatesDaCaixa.find((item) => item.id === templateId) ??
    (templateId === '' ? templatesDaCaixa[0] : undefined);
  const audience = audiences[audienceIndex];
  const totalVariaveis = template ? templateVariableCount(template.body) : 0;

  const variaveisCompletas: CampaignVariable[] = useMemo(
    () =>
      Array.from(
        { length: totalVariaveis },
        (_, i) => variables[i] ?? { source: 'texto', value: '' },
      ),
    [totalVariaveis, variables],
  );
  const preview = useMemo(
    () =>
      template
        ? renderTemplate(template.body, resolveCampaignVariables(variaveisCompletas, EXEMPLO))
        : '',
    [template, variaveisCompletas],
  );
  const faltaVariavel = variaveisCompletas.some((v) => v.source === 'texto' && !v.value.trim());

  const setVariable = (index: number, value: CampaignVariable) =>
    setVariables((current) => {
      const next = [...variaveisCompletas];
      next[index] = value;
      return next.length > current.length
        ? next
        : next.slice(0, Math.max(current.length, index + 1));
    });

  const podeAvancar =
    step === 1
      ? Boolean(inbox && template)
      : step === 2
        ? !faltaVariavel
        : step === 3
          ? Boolean(audience && audience.contactCount > 0)
          : true;

  const handleFinish = () => {
    if (!template || !inbox || !audience) return;
    setError(null);
    const finalName = name.trim() || `${template.name} · ${new Date().toLocaleDateString('pt-BR')}`;

    startTransition(async () => {
      const res = await createCampaignAction({
        name: finalName,
        inboxId: inbox.id,
        templateId: template.id,
        audience: audience.audience,
        variables: variaveisCompletas,
        scheduledAt: scheduledAt || undefined,
        rateLimit,
      });

      if (res.ok && res.data) {
        router.push(`/campanhas/${res.data.id}`);
      } else {
        setError(res.error ?? 'Erro ao criar campanha.');
      }
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div>
        <WizardSteps current={step} onSelect={(alvo) => (alvo < step ? setStep(alvo) : null)} />

        {error ? (
          <div className="mb-4 rounded-control border border-red-border bg-red-soft px-3 py-2 text-body text-red-text">
            {error}
          </div>
        ) : null}

        <Card>
          {step === 1 ? (
            <div className="flex flex-col gap-4">
              <Field label="Nome da campanha" htmlFor="campaign-name" hint="Só para a sua lista.">
                <TextInput
                  id="campaign-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: Reativação de clientes · setembro"
                />
              </Field>

              <Field
                label="Sai pelo número"
                htmlFor="campaign-inbox"
                hint="Só caixas conectadas pela API oficial da Meta disparam campanhas."
              >
                <Select
                  id="campaign-inbox"
                  value={inboxId}
                  onChange={(e) => {
                    setInboxId(e.target.value);
                    setTemplateId('');
                    setVariables([]);
                  }}
                >
                  {inboxes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.phone}
                      {item.connected ? '' : ' (com problema)'}
                    </option>
                  ))}
                </Select>
              </Field>
              {inbox && !inbox.connected ? (
                <p className="rounded-control border border-amber-border bg-amber-soft px-3 py-2 text-meta text-amber-text">
                  Esta caixa está com problema na Meta. A campanha fica na fila até ela voltar.
                </p>
              ) : null}

              <div>
                <p className="mb-2 text-meta font-semibold text-muted">Template aprovado</p>
                {templatesDaCaixa.length === 0 ? (
                  <p className="text-body text-muted">
                    Nenhum template aprovado nesta conta do WhatsApp Business. Sincronize em
                    Templates.
                  </p>
                ) : (
                  <ul className="flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1">
                    {templatesDaCaixa.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setTemplateId(item.id);
                            setVariables([]);
                          }}
                          className={cn(
                            'w-full rounded-control border px-3 py-3 text-left transition-colors',
                            item.id === template?.id
                              ? 'border-brand bg-selected'
                              : 'border-line hover:bg-surface-2',
                          )}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="font-mono text-body text-ink">{item.name}</span>
                            <span className="flex items-center gap-1.5">
                              {item.category ? (
                                <Badge tone="slate">{item.category.toLowerCase()}</Badge>
                              ) : null}
                              {item.language ? <Badge tone="slate">{item.language}</Badge> : null}
                            </span>
                          </span>
                          <span className="mt-1 line-clamp-3 block whitespace-pre-wrap text-meta text-muted">
                            {item.body}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="flex flex-col gap-4">
              {totalVariaveis === 0 ? (
                <p className="text-body text-muted">Este template não tem variáveis.</p>
              ) : (
                <p className="text-body text-muted">
                  Cada variável pode ser um texto igual para todos ou um campo do contato,
                  preenchido um a um na hora do envio.
                </p>
              )}
              {variaveisCompletas.map((variavel, index) => (
                <div
                  key={index}
                  className="grid gap-2 rounded-control border border-line p-3 sm:grid-cols-[140px_1fr]"
                >
                  <div>
                    <p className="font-mono text-body font-semibold text-ink">{`{{${index + 1}}}`}</p>
                    <Select
                      aria-label={`Origem da variável ${index + 1}`}
                      className="mt-1"
                      value={variavel.source === 'campo' ? `campo:${variavel.field}` : 'texto'}
                      onChange={(e) => {
                        const valor = e.target.value;
                        if (valor === 'texto') setVariable(index, { source: 'texto', value: '' });
                        else
                          setVariable(index, {
                            source: 'campo',
                            field: valor.slice('campo:'.length) as CampaignContactField,
                          });
                      }}
                    >
                      <option value="texto">Texto fixo</option>
                      {CAMPOS.map((campo) => (
                        <option key={campo} value={`campo:${campo}`}>
                          {CAMPAIGN_CONTACT_FIELD_LABELS[campo]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  {variavel.source === 'texto' ? (
                    <Field label="Valor" htmlFor={`campaign-var-${index}`}>
                      <TextInput
                        id={`campaign-var-${index}`}
                        value={variavel.value}
                        maxLength={300}
                        onChange={(e) =>
                          setVariable(index, { source: 'texto', value: e.target.value })
                        }
                        placeholder="Igual para todos os destinatários"
                      />
                    </Field>
                  ) : (
                    <p className="self-end pb-2 text-meta text-muted">
                      Preenchido com {CAMPAIGN_CONTACT_FIELD_LABELS[variavel.field].toLowerCase()}{' '}
                      de cada contato. Contato sem o campo recebe um traço.
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="flex flex-col gap-3">
              <p className="text-body text-muted">
                Grupos, contatos arquivados, sem telefone e quem pediu para não receber ficam de
                fora em qualquer origem. Um telefone recebe uma vez só.
              </p>
              <ul className="flex max-h-[460px] flex-col gap-2 overflow-y-auto pr-1">
                {audiences.map((item, index) => (
                  <li key={`${item.audience.kind}-${index}`}>
                    <button
                      type="button"
                      onClick={() => setAudienceIndex(index)}
                      disabled={item.contactCount === 0}
                      className={cn(
                        'w-full rounded-control border px-3 py-3 text-left transition-colors disabled:opacity-50',
                        index === audienceIndex
                          ? 'border-brand bg-selected'
                          : 'border-line hover:bg-surface-2',
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-ui font-semibold text-ink">{item.label}</span>
                        <Badge tone={item.contactCount > 0 ? 'blue' : 'slate'}>
                          {formatNumber(item.contactCount)} contatos
                        </Badge>
                      </span>
                      <span className="mt-0.5 block text-meta text-muted">{item.description}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="flex flex-col gap-4">
              <Field
                label="Quando disparar"
                htmlFor="scheduled-at"
                hint="Vazio dispara assim que você confirmar."
              >
                <TextInput
                  id="scheduled-at"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </Field>
              <Field
                label="Ritmo (envios por minuto)"
                htmlFor="rate-limit"
                hint="A Meta limita quantos clientes novos um número alcança por dia. Comece devagar num número recente."
              >
                <TextInput
                  id="rate-limit"
                  type="number"
                  value={rateLimit}
                  onChange={(e) =>
                    setRateLimit(Math.min(600, Math.max(1, parseInt(e.target.value, 10) || 30)))
                  }
                  min={1}
                  max={600}
                />
              </Field>

              <div className="flex gap-2 rounded-control border border-amber-border bg-amber-soft px-3 py-2.5 text-meta text-amber-text">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <p>
                  Cada template entregue é cobrado pela Meta na sua conta do WhatsApp Business, pela
                  categoria do template e pelo país do destinatário.{' '}
                  {audience ? (
                    <>
                      Esta campanha alcança até{' '}
                      <strong>{formatNumber(audience.contactCount)}</strong> contatos.
                    </>
                  ) : null}
                </p>
              </div>
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
              <Button
                size="sm"
                disabled={!podeAvancar}
                onClick={() => setStep((current) => Math.min(4, current + 1))}
              >
                Continuar
              </Button>
            ) : (
              <Button size="sm" variant="gradient" disabled={isPending} onClick={handleFinish}>
                {isPending
                  ? 'Criando…'
                  : scheduledAt
                    ? 'Agendar campanha'
                    : `Disparar para ${formatNumber(audience?.contactCount ?? 0)} contatos`}
              </Button>
            )}
          </div>
        </Card>
      </div>

      <TemplatePreview
        preview={preview}
        inboxLabel={inbox ? `${inbox.name} · ${inbox.phone}` : undefined}
        audienceLabel={audience?.label}
        recipients={audience?.contactCount}
        templateName={template?.name}
        scheduleLabel={scheduledAt ? scheduledAt.replace('T', ' às ') : 'imediato'}
      />
    </div>
  );
}
