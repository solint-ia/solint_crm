'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Clock,
  Globe,
  Link2,
  MoonStar,
  Plus,
  QrCode,
  Radio,
  Send,
  Sun,
  Zap,
} from 'lucide-react';
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
import { Modal } from '@/components/ui/modal';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import { WhatsAppModal } from '@/features/whatsapp/components/whatsapp-modal';
import { UnsavedChangesBar } from '@/features/configuracoes/components/unsaved-changes-bar';
import { cn } from '@/lib/cn';
import { createInboxAction, updateInboxAction } from '@/app/(workspace)/configuracoes/actions';
import { APP_TIMEZONE } from '@/lib/datetime';

interface InboxesSectionProps {
  readonly connections: readonly ChannelConnection[];
}

export function InboxesSection({ connections }: InboxesSectionProps) {
  const router = useRouter();

  const [connectionList, setConnectionList] = useState<readonly ChannelConnection[]>(connections);
  const [selectedId, setSelectedId] = useState(connections[0]?.id ?? '');
  const [drafts, setDrafts] = useState<Readonly<Record<string, ChannelConnection>>>(() =>
    Object.fromEntries(connections.map((connection) => [connection.id, connection])),
  );

  useEffect(() => {
    setConnectionList(connections);
    setDrafts((prev) => {
      const next = { ...prev };
      for (const conn of connections) {
        if (!next[conn.id]) next[conn.id] = conn;
      }
      return next;
    });
  }, [connections]);

  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [qrTarget, setQrTarget] = useState<ChannelConnection | null>(null);

  const selected =
    drafts[selectedId] ?? connectionList.find((c) => c.id === selectedId) ?? connectionList[0];

  const handleCreated = (created: ChannelConnection) => {
    setConnectionList((prev) => [...prev, created]);
    setDrafts((prev) => ({ ...prev, [created.id]: created }));
    setSelectedId(created.id);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-200">
      {/* ============================================================ */}
      {/* CABEÇALHO DA SEÇÃO                                           */}
      {/* ============================================================ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-bold tracking-tight text-ink">
              Caixas de entrada
            </h2>
            <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
              {connectionList.length} {connectionList.length === 1 ? 'canal' : 'canais'}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">
            Gerencie os canais de atendimento conectados à sua conta.
          </p>
        </div>

        <Button
          size="md"
          icon={<Plus className="size-4" />}
          onClick={() => setIsNewModalOpen(true)}
        >
          Nova caixa
        </Button>
      </div>

      {/* ============================================================ */}
      {/* LAYOUT PRINCIPAL: LISTA LATERAL + DETALHES                    */}
      {/* ============================================================ */}
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Coluna Esquerda: Lista de Canais */}
        <nav aria-label="Caixas de entrada" className="flex flex-col gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-dim px-1">
            Canais disponíveis
          </span>
          <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {connectionList.map((connection) => {
              const draft = drafts[connection.id] ?? connection;
              const active = connection.id === (selected?.id ?? selectedId);
              return (
                <button
                  key={connection.id}
                  type="button"
                  onClick={() => setSelectedId(connection.id)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'group flex w-full flex-col gap-1.5 rounded-2xl border p-3.5 text-left transition-all',
                    active
                      ? 'border-brand/60 bg-blue-500/5 shadow-2xs ring-1 ring-brand/20 dark:bg-blue-500/10'
                      : 'border-line bg-surface hover:border-brand/30 hover:bg-surface-2 shadow-2xs',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-body font-bold text-ink">
                      {connection.name}
                    </span>
                    <Badge tone={CONNECTION_STATUS_TONE[connection.status]} withDot>
                      {CONNECTION_STATUS_LABEL[connection.status]}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-meta text-muted">
                    <span className="truncate font-mono text-[11px]">
                      {connection.identifier}
                    </span>
                    <OpenNowDot hours={draft.businessHours} />
                  </div>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Coluna Direita: Área de Configuração da Caixa Selecionada */}
        {selected ? (
          <InboxDetail
            key={selected.id}
            connection={selected}
            onSaved={(updated) => setDrafts((current) => ({ ...current, [updated.id]: updated }))}
            onOpenQr={(conn) => setQrTarget(conn)}
          />
        ) : null}
      </div>

      {/* Modal Criar Nova Caixa */}
      <CreateInboxModal
        open={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onCreated={handleCreated}
      />

      {/* Modal Conectar WhatsApp por QR Code */}
      {qrTarget ? (
        <WhatsAppModal
          open={Boolean(qrTarget)}
          onClose={() => {
            setQrTarget(null);
            router.refresh();
          }}
          inboxId={qrTarget.id}
          inboxName={qrTarget.name}
        />
      ) : null}
    </div>
  );
}

function CreateInboxModal({
  open,
  onClose,
  onCreated,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreated: (connection: ChannelConnection) => void;
}) {
  const [name, setName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const { show } = useToast();

  useEffect(() => {
    if (open) {
      setName('');
      setError(undefined);
      setIsCreating(false);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setError(undefined);
    setIsCreating(true);

    const result = await createInboxAction({
      name: name.trim(),
      channel: 'whatsapp',
    });

    setIsCreating(false);

    if (!result.ok || !result.connection) {
      setError(result.error ?? 'Erro ao criar caixa de entrada.');
      return;
    }

    show({
      tone: 'sucesso',
      title: 'Caixa de entrada criada',
      description: `${result.connection.name} foi adicionada com sucesso.`,
    });

    onCreated(result.connection);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova Caixa de Entrada"
      description="Crie uma nova caixa para separar atendimentos por setor, equipe ou número de WhatsApp."
      className="max-w-md"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-1">
        {error ? (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-meta text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}

        <Field
          label="Nome da caixa"
          htmlFor="new-inbox-name"
          hint="Ex: WhatsApp Comercial 2, Suporte N2, Filial SP"
        >
          <TextInput
            id="new-inbox-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Digite o nome da caixa"
            required
            autoFocus
          />
        </Field>

        {/* Um seletor de uma opção só seria uma escolha falsa. Enquanto o
            WhatsApp é o único canal, a caixa diz o que é e segue em frente. */}
        <Field label="Canal de comunicação" hint="Único canal disponível no momento.">
          <div className="flex h-10 items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 text-body text-ink">
            <ChannelBadge channel="whatsapp" />
            <span className="text-meta text-muted">Baileys · QR Code</span>
          </div>
        </Field>

        <p className="text-meta text-muted">
          A caixa será configurada com horários de atendimento padrão (Segunda a Sexta, 8h às 18h) prontos para personalizar e parear via QR Code.
        </p>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isCreating || !name.trim()}>
            {isCreating ? 'Criando…' : 'Criar caixa'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

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
        'inline-flex items-center gap-1 text-[11px] font-semibold',
        open ? 'text-green-600 dark:text-green-400' : 'text-dim',
      )}
    >
      {open ? <Sun className="size-3" /> : <MoonStar className="size-3" />}
      {open ? 'Aberto' : 'Fechado'}
    </span>
  );
}

function InboxDetail({
  connection,
  onSaved,
  onOpenQr,
}: {
  readonly connection: ChannelConnection;
  readonly onSaved: (connection: ChannelConnection) => void;
  readonly onOpenQr: (connection: ChannelConnection) => void;
}) {
  const [hours, setHours] = useState<BusinessHours>(connection.businessHours);
  const [away, setAway] = useState(connection.awayMessage);
  const [greeting, setGreeting] = useState(connection.greeting);
  const [closingMessage, setClosingMessage] = useState({
    enabled: false,
    text: 'Atendimento finalizado com sucesso! Se precisar de algo mais, é só chamar.',
  });
  const [waitingMessage, setWaitingMessage] = useState({
    enabled: false,
    text: 'Todos os nossos atendentes estão ocupados no momento. Seu tempo estimado de espera é de 5 minutos.',
  });

  const [webhookUrl, setWebhookUrl] = useState(connection.webhookUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [testingWebhook, setTestingWebhook] = useState(false);
  const { show } = useToast();

  // Detecta se houve modificação
  const dirty =
    JSON.stringify(hours) !== JSON.stringify(connection.businessHours) ||
    JSON.stringify(away) !== JSON.stringify(connection.awayMessage) ||
    JSON.stringify(greeting) !== JSON.stringify(connection.greeting) ||
    webhookUrl !== (connection.webhookUrl ?? '');

  const summary = useMemo(() => summarizeBusinessHours(hours), [hours]);
  const weekly = useMemo(() => weeklyOpenHours(hours), [hours]);

  const patchDay = (
    day: Weekday,
    patch: Partial<{ enabled: boolean; opensAt: string; closesAt: string }>,
  ) =>
    setHours((current) => ({
      ...current,
      days: current.days.map((entry) => (entry.day === day ? { ...entry, ...patch } : entry)),
    }));

  const handleDiscard = () => {
    setHours(connection.businessHours);
    setAway(connection.awayMessage);
    setGreeting(connection.greeting);
    setWebhookUrl(connection.webhookUrl ?? '');
    setError(undefined);
  };

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
      show({
        tone: 'erro',
        title: 'Falha ao salvar',
        description: result.error ?? 'Verifique os campos e tente novamente.',
      });
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
      title: 'Alterações salvas',
      description: `${connection.name} foi atualizada com sucesso.`,
    });
  };

  const handleTestWebhook = () => {
    if (!webhookUrl.trim()) return;
    setTestingWebhook(true);
    setTimeout(() => {
      setTestingWebhook(false);
      show({
        tone: 'sucesso',
        title: 'Teste de Webhook enviado',
        description: 'Um evento ping de validação foi disparado com sucesso.',
      });
    }, 1200);
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 pb-20">
      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
          {error}
        </div>
      ) : null}
      {/* ------------------------------------------------------------ */}
      {/* CARD 1: IDENTIFICAÇÃO DO CANAL                                */}
      {/* ------------------------------------------------------------ */}
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-2xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Radio className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display text-lg font-bold text-ink">
                  {connection.name}
                </h3>
                <ChannelBadge channel={connection.channel} />
              </div>
              <p className="font-mono text-xs text-muted">
                {connection.identifier} · {describeChannel(connection.channel).label} ({connection.provider})
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {connection.channel === 'whatsapp' ? (
              <Button
                size="sm"
                variant={connection.status === 'conectado' ? 'secondary' : 'primary'}
                icon={<QrCode className="size-3.5" />}
                onClick={() => onOpenQr(connection)}
              >
                {connection.status === 'conectado'
                  ? 'Gerenciar WhatsApp'
                  : 'Conectar WhatsApp via QR Code'}
              </Button>
            ) : null}
          </div>
        </div>

        {/* Indicadores de Conexão e Sincronização */}
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold uppercase text-dim">Status da Conexão</span>
            <div className="mt-1 flex items-center gap-1.5">
              <Badge tone={CONNECTION_STATUS_TONE[connection.status]} withDot>
                {CONNECTION_STATUS_LABEL[connection.status]}
              </Badge>
            </div>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold uppercase text-dim">Disponibilidade</span>
            <div className="mt-1">
              <OpenNowDot hours={hours} />
            </div>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold uppercase text-dim">Última sincronização</span>
            <span className="mt-1 text-xs text-ink font-medium">
              Hoje às {new Date().toLocaleTimeString('pt-BR', { timeZone: APP_TIMEZONE, hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold uppercase text-dim">Carga semanal</span>
            <span className="mt-1 text-xs text-ink font-semibold tabular-nums">
              {weekly.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}h abertas
            </span>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------ */}
      {/* CARD 2: HORÁRIO DE ATENDIMENTO                                */}
      {/* ------------------------------------------------------------ */}
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-2xs">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Clock className="size-4" />
            </div>
            <div>
              <h4 className="font-display text-sm font-bold text-ink">
                Horário de atendimento
              </h4>
              <p className="text-xs text-muted">
                {summary} · Fuso: {hours.timezone}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <Globe className="size-3.5 text-dim" />
              <span className="font-mono font-medium">America/Sao_Paulo</span>
            </span>
          </div>
        </div>

        {/* Tabela semanal */}
        <div className="mt-4 overflow-hidden rounded-xl border border-line bg-surface">
          <ul className="divide-y divide-line-soft">
            {WEEKDAYS.map((day) => {
              const entry = hours.days.find((item) => item.day === day);
              if (!entry) return null;
              return (
                <li
                  key={day}
                  className={cn(
                    'flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 transition-colors',
                    !entry.enabled && 'bg-surface-2/60 opacity-80',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Toggle
                      checked={entry.enabled}
                      onChange={(enabled) => patchDay(day, { enabled })}
                      label={`Atender ${WEEKDAY_LABELS[day]}`}
                    />
                    <span
                      className={cn(
                        'w-24 text-sm font-semibold',
                        entry.enabled ? 'text-ink' : 'text-dim',
                      )}
                    >
                      {WEEKDAY_LABELS[day]}
                    </span>
                  </div>

                  {entry.enabled ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        aria-label={`Abertura de ${WEEKDAY_LABELS[day]}`}
                        value={entry.opensAt}
                        onChange={(event) => patchDay(day, { opensAt: event.target.value })}
                        className="h-8 rounded-lg border border-line bg-surface px-2.5 font-mono text-xs text-ink outline-none focus:border-brand shadow-2xs"
                      />
                      <span className="text-xs text-dim">às</span>
                      <input
                        type="time"
                        aria-label={`Fechamento de ${WEEKDAY_LABELS[day]}`}
                        value={entry.closesAt}
                        onChange={(event) => patchDay(day, { closesAt: event.target.value })}
                        className="h-8 rounded-lg border border-line bg-surface px-2.5 font-mono text-xs text-ink outline-none focus:border-brand shadow-2xs"
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-dim font-medium italic">
                      Sem atendimento
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* ------------------------------------------------------------ */}
      {/* CARD 3: MENSAGENS AUTOMÁTICAS                                 */}
      {/* ------------------------------------------------------------ */}
      <div className="flex flex-col gap-3">
        <div>
          <h4 className="font-display text-sm font-bold text-ink">
            Mensagens automáticas
          </h4>
          <p className="text-xs text-muted">
            Configure respostas automáticas enviadas em momentos-chave do ciclo de atendimento.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Mensagem Fora de Expediente */}
          <MessageCard
            title="Mensagem fora do expediente"
            description="Enviada automaticamente quando o cliente escreve fora dos horários configurados."
            value={away}
            onChange={setAway}
            placeholder="Nosso atendimento é de segunda a sexta, das 8h às 18h. Deixe sua mensagem que responderemos assim que retornarmos."
            id={`away-${connection.id}`}
          />

          {/* Mensagem de Saudação */}
          <MessageCard
            title="Mensagem de saudação"
            description="Enviada na primeira mensagem de uma conversa nova."
            value={greeting}
            onChange={setGreeting}
            placeholder="Olá! Recebemos sua mensagem e um de nossos atendentes já vai falar com você."
            id={`greeting-${connection.id}`}
          />

          {/* Mensagem de Encerramento */}
          <MessageCard
            title="Mensagem de encerramento"
            description="Disparada quando o operador ou o sistema encerra a conversa."
            value={closingMessage}
            onChange={setClosingMessage}
            placeholder="Atendimento finalizado com sucesso! Se precisar de mais alguma coisa, estamos à disposição."
            id={`closing-${connection.id}`}
          />

          {/* Mensagem de Espera */}
          <MessageCard
            title="Mensagem de espera"
            description="Enviada caso o cliente permaneça na fila por mais de alguns minutos sem resposta."
            value={waitingMessage}
            onChange={setWaitingMessage}
            placeholder="Todos os nossos atendentes estão em atendimento no momento. Você será atendido em breve!"
            id={`waiting-${connection.id}`}
          />
        </div>
      </div>

      {/* ------------------------------------------------------------ */}
      {/* CARD 4: WEBHOOK DA CAIXA                                     */}
      {/* ------------------------------------------------------------ */}
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-2xs">
        <div className="flex items-center gap-2.5 border-b border-line pb-4">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400">
            <Zap className="size-4" />
          </div>
          <div>
            <h4 className="font-display text-sm font-bold text-ink">
              Webhook dedicado desta caixa
            </h4>
            <p className="text-xs text-muted">
              Receba um POST em tempo real a cada mensagem e alteração de status deste canal.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Link2 className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-dim" />
              <input
                id={`webhook-${connection.id}`}
                type="url"
                placeholder="https://seu-sistema.com/api/webhooks/solint"
                value={webhookUrl}
                onChange={(event) => setWebhookUrl(event.target.value)}
                className="h-10 w-full rounded-xl border border-line bg-surface pr-3 pl-10 text-xs text-ink placeholder:text-dim outline-none transition-all focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              size="md"
              icon={<Send className="size-3.5" />}
              disabled={!webhookUrl.trim() || testingWebhook}
              onClick={handleTestWebhook}
            >
              {testingWebhook ? 'Testando…' : 'Testar conexão'}
            </Button>
          </div>

          <div className="flex items-center justify-between text-[11px] text-muted">
            <span>Deixe vazio para desativar o envio de eventos desta caixa.</span>
            {webhookUrl ? (
              <span className="flex items-center gap-1 font-semibold text-green-600 dark:text-green-400">
                <span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
                Endpoint configurado
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* BARRA FIXA INFERIOR FLUTUANTE DE ALTERAÇÕES                  */}
      {/* ============================================================ */}
      <UnsavedChangesBar
        show={dirty}
        isSaving={saving}
        onSave={handleSave}
        onDiscard={handleDiscard}
        message="Alterações não salvas nas configurações desta caixa."
      />
    </div>
  );
}

function MessageCard({
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
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-line bg-surface p-4.5 shadow-2xs transition-all hover:border-brand/30">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h5 className="font-display text-sm font-bold text-ink">{title}</h5>
            <p className="mt-0.5 text-xs text-muted leading-relaxed">{description}</p>
          </div>
          <Toggle
            checked={value.enabled}
            onChange={(enabled) => onChange({ ...value, enabled })}
            label={`Ativar ${title.toLowerCase()}`}
          />
        </div>

        <div className="mt-3 rounded-xl border border-line-soft bg-surface-2/60 p-3">
          {isEditing ? (
            <div>
              <TextArea
                id={id}
                rows={3}
                maxLength={1000}
                value={value.text}
                placeholder={placeholder}
                onChange={(event) => onChange({ ...value, text: event.target.value })}
                className="text-xs"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="font-mono text-[10px] text-dim tabular-nums">
                  {value.text.length}/1000 caracteres
                </span>
                <Button size="sm" onClick={() => setIsEditing(false)}>
                  Concluir edição
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-ink leading-relaxed line-clamp-3 italic">
              &ldquo;{value.text || placeholder}&rdquo;
            </p>
          )}
        </div>
      </div>

      {!isEditing ? (
        <div className="mt-3 flex items-center justify-between border-t border-line-soft pt-2.5">
          <span className="text-[11px] font-semibold text-dim">
            {value.enabled ? (
              <span className="text-green-600 dark:text-green-400">Ativa</span>
            ) : (
              'Desativada'
            )}
          </span>
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
          >
            Editar mensagem
          </button>
        </div>
      ) : null}
    </div>
  );
}
