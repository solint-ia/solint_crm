'use client';

import { useEffect, useMemo, useState } from 'react';
import { Clock, Link2, MoonStar, Sun } from 'lucide-react';
import type { BusinessHours, Weekday } from '@/core/domain/business-hours';
import {
  isWithinBusinessHours,
  summarizeBusinessHours,
  WEEKDAY_LABELS,
  WEEKDAYS,
  weeklyOpenHours,
} from '@/core/domain/business-hours';
import { describeChannel } from '@/core/domain/channel';
import type { ChannelConnection } from '@/core/domain/settings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChannelBadge } from '@/components/domain/channel-badge';
import {
  CONNECTION_STATUS_LABEL,
  CONNECTION_STATUS_TONE,
} from '@/components/domain/presentation-maps';
import { Field, TextArea, TextInput } from '@/components/ui/field';
import { SectionTitle } from '@/components/ui/section';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { updateInboxAction } from '@/app/(workspace)/configuracoes/actions';

interface InboxesSectionProps {
  readonly connections: readonly ChannelConnection[];
}

/**
 * Gestão de caixas de entrada (§15).
 *
 * Cada canal tem expediente próprio — o comercial fecha às 18h, o suporte vai
 * até 22h — e é isso que decide se a mensagem de ausência dispara. Configurar
 * as duas coisas na mesma tela é o que permite responder "por que o cliente
 * recebeu 'estamos fechados' às 15h?" sem abrir três abas.
 */
export function InboxesSection({ connections }: InboxesSectionProps) {
  const [selectedId, setSelectedId] = useState(connections[0]?.id ?? '');
  const [drafts, setDrafts] = useState<Readonly<Record<string, ChannelConnection>>>(() =>
    Object.fromEntries(connections.map((connection) => [connection.id, connection])),
  );

  const selected = drafts[selectedId];

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <SectionTitle
        title="Caixas de entrada"
        hint={`${connections.length} canais conectados à conta`}
      />

      <div className="grid gap-4 md:grid-cols-[248px_1fr]">
        <nav aria-label="Caixas de entrada" className="min-w-0">
          <ul className="flex gap-2 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
            {connections.map((connection) => {
              const draft = drafts[connection.id] ?? connection;
              const active = connection.id === selectedId;
              return (
                <li key={connection.id} className="shrink-0 md:shrink">
                  <button
                    type="button"
                    onClick={() => setSelectedId(connection.id)}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex w-full flex-col gap-1 rounded-control border px-3 py-2.5 text-left transition-colors',
                      active
                        ? 'border-brand bg-selected'
                        : 'border-line hover:bg-surface-2',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-body font-semibold text-ink">
                        {connection.name}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Badge tone={CONNECTION_STATUS_TONE[connection.status]} withDot>
                        {CONNECTION_STATUS_LABEL[connection.status]}
                      </Badge>
                      <OpenNowDot hours={draft.businessHours} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {selected ? (
          <InboxDetail
            key={selected.id}
            connection={selected}
            onSaved={(updated) =>
              setDrafts((current) => ({ ...current, [updated.id]: updated }))
            }
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Aberto/fechado depende do relógio do navegador, então só é decidido depois
 * da montagem: renderizar isso no servidor daria divergência de hidratação e,
 * pior, um rótulo travado no horário do build.
 */
function OpenNowDot({ hours }: { readonly hours: BusinessHours }) {
  const [open, setOpen] = useState<boolean | undefined>();

  useEffect(() => {
    const check = () => setOpen(isWithinBusinessHours(hours, new Date()));
    check();
    const timer = setInterval(check, 60_000);
    return () => clearInterval(timer);
  }, [hours]);

  if (open === undefined) return null;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-micro font-semibold',
        open ? 'text-green-text' : 'text-dim',
      )}
    >
      {open ? <Sun className="size-3" /> : <MoonStar className="size-3" />}
      {open ? 'aberto agora' : 'fora do expediente'}
    </span>
  );
}

function InboxDetail({
  connection,
  onSaved,
}: {
  readonly connection: ChannelConnection;
  readonly onSaved: (connection: ChannelConnection) => void;
}) {
  const [hours, setHours] = useState<BusinessHours>(connection.businessHours);
  const [away, setAway] = useState(connection.awayMessage);
  const [greeting, setGreeting] = useState(connection.greeting);
  const [webhookUrl, setWebhookUrl] = useState(connection.webhookUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const { show } = useToast();

  const dirty =
    JSON.stringify(hours) !== JSON.stringify(connection.businessHours) ||
    JSON.stringify(away) !== JSON.stringify(connection.awayMessage) ||
    JSON.stringify(greeting) !== JSON.stringify(connection.greeting) ||
    webhookUrl !== (connection.webhookUrl ?? '');

  const summary = useMemo(() => summarizeBusinessHours(hours), [hours]);
  const weekly = useMemo(() => weeklyOpenHours(hours), [hours]);

  const patchDay = (day: Weekday, patch: Partial<{ enabled: boolean; opensAt: string; closesAt: string }>) =>
    setHours((current) => ({
      ...current,
      days: current.days.map((entry) => (entry.day === day ? { ...entry, ...patch } : entry)),
    }));

  const handleSave = async () => {
    setError(undefined);
    setSaving(true);
    const result = await updateInboxAction({
      connectionId: connection.id,
      businessHours: hours,
      awayMessage: away,
      greeting,
      webhookUrl,
    });
    setSaving(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved({
      ...connection,
      businessHours: hours,
      awayMessage: away,
      greeting,
      webhookUrl: webhookUrl || undefined,
    });
    show({
      tone: 'sucesso',
      title: 'Caixa atualizada',
      description: `${connection.name} · ${summarizeBusinessHours(hours)}`,
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
        <h3 className="font-display text-title font-bold tracking-tight text-ink">
          {connection.name}
        </h3>
        <ChannelBadge channel={connection.channel} />
        <span className="font-mono text-meta text-muted">{connection.identifier}</span>
        <span className="ml-auto text-meta text-dim">
          {describeChannel(connection.channel).label} · {connection.provider}
        </span>
      </header>

      {/* ---------- Horário comercial ---------- */}
      <section>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="flex items-center gap-1.5 font-display text-ui font-bold tracking-tight text-ink">
            <Clock className="size-3.5 text-dim" />
            Horário de atendimento
          </h4>
          <span className="font-mono text-meta text-muted tabular-nums">
            {summary} · {weekly.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}h por semana
          </span>
        </div>

        <div className="overflow-hidden rounded-surface border border-line bg-surface">
          <ul className="divide-y divide-line-soft">
            {WEEKDAYS.map((day) => {
              const entry = hours.days.find((item) => item.day === day);
              if (!entry) return null;
              return (
                <li
                  key={day}
                  className={cn(
                    'flex flex-wrap items-center gap-3 px-3.5 py-2',
                    !entry.enabled && 'bg-surface-2/50',
                  )}
                >
                  <Toggle
                    checked={entry.enabled}
                    onChange={(enabled) => patchDay(day, { enabled })}
                    label={`Atender ${WEEKDAY_LABELS[day]}`}
                  />
                  <span
                    className={cn(
                      'w-20 text-body font-medium',
                      entry.enabled ? 'text-ink' : 'text-dim',
                    )}
                  >
                    {WEEKDAY_LABELS[day]}
                  </span>

                  {entry.enabled ? (
                    <span className="flex items-center gap-2">
                      <input
                        type="time"
                        aria-label={`Abertura de ${WEEKDAY_LABELS[day]}`}
                        value={entry.opensAt}
                        onChange={(event) => patchDay(day, { opensAt: event.target.value })}
                        className="h-8 rounded-control border border-line bg-surface px-2 font-mono text-body text-ink outline-none focus:border-brand"
                      />
                      <span className="text-meta text-dim">até</span>
                      <input
                        type="time"
                        aria-label={`Fechamento de ${WEEKDAY_LABELS[day]}`}
                        value={entry.closesAt}
                        onChange={(event) => patchDay(day, { closesAt: event.target.value })}
                        className="h-8 rounded-control border border-line bg-surface px-2 font-mono text-body text-ink outline-none focus:border-brand"
                      />
                    </span>
                  ) : (
                    <span className="text-meta text-dim">sem atendimento</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <p className="mt-1.5 text-meta text-dim">
          Fuso: {hours.timezone}. Um expediente que atravessa a meia-noite (22:00 às 02:00) é
          aceito e contabilizado no dia em que começa.
        </p>
      </section>

      {/* ---------- Mensagens automáticas ---------- */}
      <AutoReplyBlock
        title="Mensagem de fora do expediente"
        description="Enviada quando o cliente escreve com a caixa fechada. Fica desativada se o expediente for 24/7."
        value={away}
        onChange={setAway}
        placeholder="Nosso atendimento é de segunda a sexta, das 8h às 18h. Deixe sua mensagem que respondemos no próximo dia útil."
        id={`away-${connection.id}`}
      />

      <AutoReplyBlock
        title="Mensagem de saudação"
        description="Enviada na primeira mensagem de uma conversa nova, dentro ou fora do expediente."
        value={greeting}
        onChange={setGreeting}
        placeholder="Olá! Recebemos sua mensagem e já vamos te responder."
        id={`greeting-${connection.id}`}
      />

      {/* ---------- Webhook ---------- */}
      <section>
        <Field
          label="Webhook desta caixa"
          htmlFor={`webhook-${connection.id}`}
          hint="Recebe um POST a cada mensagem e mudança de status desta caixa. Deixe vazio para desligar."
          error={error && error.includes('webhook') ? error : undefined}
        >
          <div className="relative">
            <Link2 className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-dim" />
            <TextInput
              id={`webhook-${connection.id}`}
              type="url"
              inputMode="url"
              className="pl-8"
              placeholder="https://seu-sistema.com/hooks/solint"
              value={webhookUrl}
              onChange={(event) => setWebhookUrl(event.target.value)}
            />
          </div>
        </Field>
      </section>

      <footer className="flex items-center gap-3 border-t border-line pt-4">
        <Button onClick={handleSave} disabled={!dirty || saving}>
          {saving ? 'Salvando…' : 'Salvar caixa'}
        </Button>
        {dirty ? (
          <span className="text-meta text-amber-text">Há alterações não salvas.</span>
        ) : (
          <span className="text-meta text-dim">Tudo salvo.</span>
        )}
        {error && !error.includes('webhook') ? (
          <span role="alert" className="text-meta font-medium text-red-text">
            {error}
          </span>
        ) : null}
      </footer>
    </div>
  );
}

function AutoReplyBlock({
  title,
  description,
  value,
  onChange,
  placeholder,
  id,
}: {
  readonly title: string;
  readonly description: string;
  readonly value: { readonly enabled: boolean; readonly text: string };
  readonly onChange: (value: { readonly enabled: boolean; readonly text: string }) => void;
  readonly placeholder: string;
  readonly id: string;
}) {
  return (
    <section className="rounded-surface border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-display text-ui font-bold tracking-tight text-ink">{title}</h4>
          <p className="mt-0.5 text-meta leading-relaxed text-muted">{description}</p>
        </div>
        <Toggle
          checked={value.enabled}
          onChange={(enabled) => onChange({ ...value, enabled })}
          label={`Ativar ${title.toLowerCase()}`}
        />
      </div>

      {value.enabled ? (
        <div className="mt-3">
          <label htmlFor={id} className="sr-only">
            {title}
          </label>
          <TextArea
            id={id}
            rows={3}
            maxLength={1000}
            value={value.text}
            placeholder={placeholder}
            onChange={(event) => onChange({ ...value, text: event.target.value })}
          />
          <p className="mt-1 text-right font-mono text-micro text-dim tabular-nums">
            {value.text.length}/1000
          </p>
        </div>
      ) : null}
    </section>
  );
}
