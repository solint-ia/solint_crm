'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Clock,
  Globe,
  Inbox as InboxIcon,
  MoonStar,
  Plus,
  QrCode,
  Radio,
  Star,
  Sun,
  Timer,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { BusinessHours, Weekday } from '@/core/domain/business-hours';
import {
  isWithinBusinessHours,
  summarizeBusinessHours,
  WEEKDAY_LABELS,
  WEEKDAYS,
} from '@/core/domain/business-hours';
import { describeChannel } from '@/core/domain/channel';
import { DEFAULT_CSAT_QUESTION } from '@/core/domain/csat';
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
import type { InboxDeletionImpact } from '@/core/ports/settings-repository';
import {
  createInboxAction,
  deleteInboxAction,
  inboxDeletionImpactAction,
  updateInboxAction,
} from '@/app/(workspace)/configuracoes/actions';
import { useWhatsAppConnection } from '@/features/whatsapp/hooks/use-whatsapp-connection';

interface InboxesSectionProps {
  readonly connections: readonly ChannelConnection[];
  /**
   * Excluir caixa é um terceiro verbo, e não parte de "editar".
   *
   * Editar a mensagem de saudação é reversível; apagar a caixa leva junto
   * conversas e mensagens e não tem lixeira. Por isso `config.caixas:excluir`
   * existe em separado e só entra no padrão do administrador — quem edita
   * horário de atendimento não deveria poder esvaziar o histórico do canal.
   */
  readonly canDelete: boolean;
}

export function InboxesSection({ connections, canDelete }: InboxesSectionProps) {
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
    setSelectedId((current) => current || (connections[0]?.id ?? ''));
  }, [connections]);

  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [qrTarget, setQrTarget] = useState<ChannelConnection | null>(null);

  const selected =
    drafts[selectedId] ?? connectionList.find((c) => c.id === selectedId) ?? connectionList[0];

  /**
   * O status que chega pelo fluxo em tempo real vale mais que o do servidor.
   *
   * A página é renderizada no servidor e `connections` é uma fotografia do
   * momento em que ela carregou. Conectar o WhatsApp acontece **depois**, e
   * nada reavisava esta árvore — por isso o cartão continuava dizendo
   * "desconectado" até alguém recarregar a página.
   *
   * A gravação entra nas duas listas de propósito: `connectionList` é o que a
   * coluna da esquerda desenha, `drafts` é o que o painel da direita lê.
   * Atualizar só uma faria os dois discordarem na mesma tela.
   */
  const handleLiveStatus = useCallback(
    (connectionId: string, status: ChannelConnection['status']) => {
      setConnectionList((prev) =>
        prev.map((item) => (item.id === connectionId && item.status !== status ? { ...item, status } : item)),
      );
      setDrafts((prev) => {
        const atual = prev[connectionId];
        if (!atual || atual.status === status) return prev;
        return { ...prev, [connectionId]: { ...atual, status } };
      });
    },
    [],
  );

  const handleCreated = (created: ChannelConnection) => {
    setConnectionList((prev) => [...prev, created]);
    setDrafts((prev) => ({ ...prev, [created.id]: created }));
    setSelectedId(created.id);
    router.refresh();
  };

  /**
   * A caixa excluída sai da lista e a seleção passa para a vizinha.
   *
   * Deixar `selectedId` apontando para o que não existe mais faria a coluna da
   * direita sumir sem explicação — a tela pareceria quebrada logo depois de
   * uma ação que deu certo.
   */
  const handleDeleted = (deletedId: string) => {
    setConnectionList((prev) => {
      const next = prev.filter((connection) => connection.id !== deletedId);
      setSelectedId((current) => (current === deletedId ? (next[0]?.id ?? '') : current));
      return next;
    });
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[deletedId];
      return next;
    });
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
      {/* Sem nenhuma caixa não há o que listar nem o que detalhar: a grade de
          duas colunas viraria uma coluna vazia ao lado de um vazio. */}
      {connectionList.length === 0 ? (
        <EmptyInboxState onCreate={() => setIsNewModalOpen(true)} />
      ) : (
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
              onDeleted={handleDeleted}
              onLiveStatus={handleLiveStatus}
              canDelete={canDelete}
            />
          ) : null}
        </div>
      )}

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
          A caixa será configurada com horários de atendimento padrão (Segunda a Sexta, 8h às 18h)
          prontos para personalizar e parear via QR Code.
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

/**
 * Confirmação de exclusão da caixa.
 *
 * Pede o nome digitado por escrito. Um "tem certeza?" com dois botões é
 * respondido no reflexo — e o que está do outro lado deste é o histórico de
 * atendimento de contatos reais, sem lixeira e sem desfazer. Digitar o nome
 * obriga a olhar para qual caixa é, que é justamente o erro que este tipo de
 * ação costuma produzir: apagar a certa pelo motivo errado, ou a errada por
 * distração.
 *
 * Os números vêm do servidor ao abrir. Enquanto não chegam, o botão espera:
 * confirmar sem saber o tamanho do estrago é o mesmo que não ter confirmado.
 */
function DeleteInboxModal({
  open,
  connection,
  onClose,
  onDeleted,
}: {
  readonly open: boolean;
  readonly connection: ChannelConnection;
  readonly onClose: () => void;
  readonly onDeleted: (connectionId: string) => void;
}) {
  const [typedName, setTypedName] = useState('');
  const [impact, setImpact] = useState<InboxDeletionImpact | undefined>();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const { show } = useToast();

  useEffect(() => {
    if (!open) return;

    setTypedName('');
    setImpact(undefined);
    setError(undefined);
    setIsDeleting(false);

    let cancelled = false;
    void inboxDeletionImpactAction({ connectionId: connection.id }).then((result) => {
      if (cancelled) return;
      if (result.ok && result.impact) setImpact(result.impact);
      else setError(result.error ?? 'Não foi possível ler o conteúdo desta caixa.');
    });

    return () => {
      cancelled = true;
    };
  }, [open, connection.id]);

  const nameMatches = typedName.trim() === connection.name.trim();
  const canDelete = nameMatches && impact !== undefined && !isDeleting;

  const handleDelete = async () => {
    if (!canDelete) return;

    setError(undefined);
    setIsDeleting(true);

    const result = await deleteInboxAction({
      connectionId: connection.id,
      confirmName: typedName.trim(),
    });

    if (!result.ok) {
      setIsDeleting(false);
      setError(result.error ?? 'Erro ao excluir a caixa de entrada.');
      return;
    }

    show({
      tone: 'sucesso',
      title: 'Caixa de entrada excluída',
      description: `${connection.name} e o histórico dela foram removidos.`,
    });

    onDeleted(connection.id);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Excluir ${connection.name}`}
      description="Esta ação é permanente. Não há lixeira e não é possível desfazer."
      className="max-w-md"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleDelete();
        }}
        className="flex flex-col gap-4 pt-1"
      >
        {error ? (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-meta text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}

        <div className="rounded-xl border border-red-line/50 bg-red-soft/40 p-3.5">
          <div className="flex items-center gap-2">
            <TriangleAlert className="size-4 shrink-0 text-red-600 dark:text-red-400" />
            <span className="text-xs font-bold text-ink">O que será apagado</span>
          </div>

          {impact ? (
            <ul className="mt-2.5 flex flex-col gap-1 text-xs text-muted">
              <li>
                <strong className="text-ink tabular-nums">{impact.conversations}</strong>{' '}
                {impact.conversations === 1 ? 'conversa' : 'conversas'} desta caixa
              </li>
              <li>
                <strong className="text-ink tabular-nums">{impact.messages}</strong>{' '}
                {impact.messages === 1 ? 'mensagem' : 'mensagens'} do histórico
              </li>
              {impact.campaigns > 0 ? (
                <li>
                  <strong className="text-ink tabular-nums">{impact.campaigns}</strong>{' '}
                  {impact.campaigns === 1 ? 'campanha' : 'campanhas'} que usavam este canal
                </li>
              ) : null}
              {connection.channel === 'whatsapp' ? (
                <li>A conexão do WhatsApp e o pareamento do número</li>
              ) : null}
            </ul>
          ) : (
            <p className="mt-2.5 text-xs text-muted">Somando o que há na caixa…</p>
          )}

          <p className="mt-3 border-t border-red-line/40 pt-2.5 text-[11px] text-muted">
            Os contatos continuam na conta, com as conversas que tiverem em outras caixas.
          </p>
        </div>

        <Field
          label="Digite o nome da caixa para confirmar"
          htmlFor={`confirm-delete-${connection.id}`}
          hint={connection.name}
        >
          <TextInput
            id={`confirm-delete-${connection.id}`}
            value={typedName}
            onChange={(event) => setTypedName(event.target.value)}
            placeholder={connection.name}
            autoComplete="off"
            autoFocus
          />
        </Field>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="danger"
            icon={<Trash2 className="size-3.5" />}
            disabled={!canDelete}
          >
            {isDeleting ? 'Excluindo…' : 'Excluir definitivamente'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Nenhuma caixa restou — a coluna de detalhes precisa dizer o que fazer agora. */
function EmptyInboxState({ onCreate }: { readonly onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line bg-surface-2/40 px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
        <InboxIcon className="size-6" />
      </div>
      <div>
        <h3 className="font-display text-base font-bold text-ink">Nenhuma caixa de entrada</h3>
        <p className="mt-1 max-w-sm text-xs text-muted">
          Sem uma caixa conectada, a conta não recebe mensagem nenhuma. Crie uma para parear um
          número de WhatsApp.
        </p>
      </div>
      <Button size="sm" icon={<Plus className="size-4" />} onClick={onCreate}>
        Nova caixa
      </Button>
    </div>
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

/**
 * Um intervalo em dias, horas e minutos.
 *
 * Só mostra a unidade que tem valor: "3 d 2 h" não vira "3 d 2 h 0 min", e
 * abaixo de um minuto o texto é "agora mesmo" em vez de um zero solitário.
 */
const duracaoLabel = (desde: Date, agora: number): string => {
  const total = Math.max(0, agora - desde.getTime());
  const minutos = Math.floor(total / 60_000);
  if (minutos < 1) return 'agora mesmo';

  const dias = Math.floor(minutos / 1440);
  const horas = Math.floor((minutos % 1440) / 60);
  const restoMin = minutos % 60;

  const partes: string[] = [];
  if (dias > 0) partes.push(`${dias} d`);
  if (horas > 0) partes.push(`${horas} h`);
  // Os minutos somem quando já há dias na conta: num intervalo de dias eles
  // são ruído, e a linha fica mais curta do que a coluna.
  if (restoMin > 0 && dias === 0) partes.push(`${restoMin} min`);
  return partes.join(' ');
};

function InboxDetail({
  connection,
  onSaved,
  onOpenQr,
  onDeleted,
  onLiveStatus,
  canDelete,
}: {
  readonly connection: ChannelConnection;
  readonly onSaved: (connection: ChannelConnection) => void;
  readonly onOpenQr: (connection: ChannelConnection) => void;
  readonly onDeleted: (connectionId: string) => void;
  readonly onLiveStatus: (connectionId: string, status: ChannelConnection['status']) => void;
  readonly canDelete: boolean;
}) {
  const isWhatsApp = connection.channel === 'whatsapp';
  const { statusData } = useWhatsAppConnection(isWhatsApp, connection.id);

  /**
   * O status que a tela desenha: o do fluxo quando ele já falou, o do servidor
   * enquanto não. `updatedAt` do zero é a marca do estado inicial do hook —
   * usá-lo cedo demais faria o cartão piscar "desconectado" ao abrir a página.
   */
  const statusAoVivo: ChannelConnection['status'] | undefined =
    isWhatsApp && statusData.updatedAt !== new Date(0).toISOString()
      ? statusData.status === 'conectado'
        ? 'conectado'
        : statusData.status === 'desconectado'
          ? 'desconectado'
          : 'pareando'
      : undefined;

  const statusExibido = statusAoVivo ?? connection.status;

  useEffect(() => {
    if (statusAoVivo && statusAoVivo !== connection.status) {
      onLiveStatus(connection.id, statusAoVivo);
    }
  }, [statusAoVivo, connection.status, connection.id, onLiveStatus]);

  /**
   * Um relógio de minuto em minuto só enquanto há conexão para contar.
   *
   * O tempo de conexão é derivado de um instante fixo; sem alguém pedindo o
   * novo render, ele congelaria no valor de quando a página abriu.
   */
  const [agora, setAgora] = useState(() => Date.now());
  const conectadoDesde = statusData.connectedAt ? new Date(statusData.connectedAt) : undefined;
  const contando = statusExibido === 'conectado' && Boolean(conectadoDesde);

  useEffect(() => {
    if (!contando) return;
    setAgora(Date.now());
    const relogio = setInterval(() => setAgora(Date.now()), 60_000);
    return () => clearInterval(relogio);
  }, [contando]);

  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [hours, setHours] = useState<BusinessHours>(connection.businessHours);
  const [away, setAway] = useState(connection.awayMessage);
  const [greeting, setGreeting] = useState(connection.greeting);
  const [closingMessage, setClosingMessage] = useState(
    connection.closingMessage ?? {
      enabled: false,
      text: 'Atendimento finalizado com sucesso! Se precisar de algo mais, é só chamar.',
    },
  );
  const [waitingMessage, setWaitingMessage] = useState(
    connection.waitingMessage ?? {
      enabled: false,
      text: 'Todos os nossos atendentes estão ocupados no momento. Seu tempo estimado de espera é de 5 minutos.',
    },
  );

  const [waitingDelay, setWaitingDelay] = useState(connection.waitingMessageDelayMinutes || 5);
  const [csatEnabled, setCsatEnabled] = useState(connection.csatEnabled ?? false);
  const [csatQuestion, setCsatQuestion] = useState(connection.csatQuestion ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const { show } = useToast();

  // Detecta se houve modificação
  const dirty =
    JSON.stringify(hours) !== JSON.stringify(connection.businessHours) ||
    JSON.stringify(away) !== JSON.stringify(connection.awayMessage) ||
    JSON.stringify(greeting) !== JSON.stringify(connection.greeting) ||
    JSON.stringify(closingMessage) !==
      JSON.stringify(
        connection.closingMessage ?? {
          enabled: false,
          text: 'Atendimento finalizado com sucesso! Se precisar de algo mais, é só chamar.',
        },
      ) ||
    JSON.stringify(waitingMessage) !==
      JSON.stringify(
        connection.waitingMessage ?? {
          enabled: false,
          text: 'Todos os nossos atendentes estão ocupados no momento. Seu tempo estimado de espera é de 5 minutos.',
        },
      ) ||
    waitingDelay !== (connection.waitingMessageDelayMinutes || 5) ||
    csatEnabled !== (connection.csatEnabled ?? false) ||
    csatQuestion !== (connection.csatQuestion ?? '');

  const summary = useMemo(() => summarizeBusinessHours(hours), [hours]);

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
    setClosingMessage(
      connection.closingMessage ?? {
        enabled: false,
        text: 'Atendimento finalizado com sucesso! Se precisar de algo mais, é só chamar.',
      },
    );
    setWaitingMessage(
      connection.waitingMessage ?? {
        enabled: false,
        text: 'Todos os nossos atendentes estão ocupados no momento. Seu tempo estimado de espera é de 5 minutos.',
      },
    );
    setWaitingDelay(connection.waitingMessageDelayMinutes || 5);
    setCsatEnabled(connection.csatEnabled ?? false);
    setCsatQuestion(connection.csatQuestion ?? '');
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
      closingMessage,
      waitingMessage,
      waitingMessageDelayMinutes: waitingDelay,
      csatEnabled,
      csatQuestion,
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
      closingMessage,
      waitingMessage,
      waitingMessageDelayMinutes: waitingDelay,
      csatEnabled,
      ...(csatQuestion ? { csatQuestion } : {}),
    });

    show({
      tone: 'sucesso',
      title: 'Alterações salvas',
      description: `${connection.name} foi atualizada com sucesso.`,
    });
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
                <h3 className="font-display text-lg font-bold text-ink">{connection.name}</h3>
                <ChannelBadge channel={connection.channel} />
              </div>
              <p className="font-mono text-xs text-muted">
                {connection.identifier} · {describeChannel(connection.channel).label} (
                {connection.provider})
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
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold uppercase text-dim">Status da Conexão</span>
            <div className="mt-1 flex items-center gap-1.5">
              <Badge tone={CONNECTION_STATUS_TONE[statusExibido]} withDot>
                {CONNECTION_STATUS_LABEL[statusExibido]}
              </Badge>
            </div>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold uppercase text-dim">Disponibilidade</span>
            <div className="mt-1">
              <OpenNowDot hours={hours} />
            </div>
          </div>
          {/* Aqui havia "Última sincronização" e "Carga semanal". A primeira
              imprimia `new Date()` no render — ou seja, dizia "agora" toda vez,
              independentemente de ter havido sincronização; a segunda repetia
              uma conta que o cartão de horário logo abaixo já mostra por dia. */}
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold uppercase text-dim">Tempo de conexão</span>
            <span className="mt-1 text-xs text-ink font-semibold tabular-nums">
              {contando && conectadoDesde ? duracaoLabel(conectadoDesde, agora) : '—'}
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
              <h4 className="font-display text-sm font-bold text-ink">Horário de atendimento</h4>
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
                    <span className="text-xs text-dim font-medium italic">Sem atendimento</span>
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
          <h4 className="font-display text-sm font-bold text-ink">Mensagens automáticas</h4>
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
            description="Enviada quando o cliente fica na fila sem resposta pelo tempo definido abaixo."
            value={waitingMessage}
            onChange={setWaitingMessage}
            placeholder="Todos os nossos atendentes estão em atendimento no momento. Você será atendido em breve!"
            id={`waiting-${connection.id}`}
            extra={
              <label className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <Timer className="size-3.5 shrink-0 text-dim" />
                <span>Enviar depois de</span>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={waitingDelay}
                  onChange={(event) =>
                    setWaitingDelay(Math.min(120, Math.max(1, Number(event.target.value) || 1)))
                  }
                  aria-label="Minutos de espera antes do aviso"
                  className="h-8 w-16 rounded-lg border border-line bg-surface px-2 text-center font-mono text-xs text-ink outline-none focus:border-brand shadow-2xs"
                />
                <span>minutos na fila</span>
              </label>
            }
          />
        </div>

        {/* ---------------------------------------------------------- */}
        {/* PESQUISA DE SATISFAÇÃO (CSAT)                              */}
        {/* ---------------------------------------------------------- */}
        <div className="rounded-2xl border border-line bg-surface p-4.5 shadow-2xs">
          <div className="flex items-start justify-between gap-3 border-b border-line-soft pb-3.5">
            <div className="flex items-start gap-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
                <Star className="size-4" />
              </div>
              <div className="min-w-0">
                <h5 className="font-display text-sm font-bold text-ink">
                  Pesquisa de satisfação (CSAT)
                </h5>
                <p className="mt-0.5 text-xs text-muted leading-relaxed">
                  Ao encerrar o atendimento, pergunta a nota de 1 a 5. A resposta do cliente é lida
                  automaticamente e vira o índice de CSAT do painel e dos relatórios.
                </p>
              </div>
            </div>
            <Toggle
              checked={csatEnabled}
              onChange={setCsatEnabled}
              label="Ativar pesquisa de satisfação"
            />
          </div>

          <div className="mt-3.5">
            <TextArea
              id={`csat-${connection.id}`}
              rows={2}
              maxLength={300}
              value={csatQuestion}
              placeholder={DEFAULT_CSAT_QUESTION}
              onChange={(event) => setCsatQuestion(event.target.value)}
              className="text-xs"
              disabled={!csatEnabled}
            />
            <p className="mt-1.5 text-[11px] text-dim">
              Deixe vazio para usar a pergunta padrão. O cliente responde com o número, com
              &ldquo;nota 4&rdquo; ou com estrelas — todas as formas são aceitas.
            </p>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------ */}
      {/* CARD 4: ZONA DE RISCO (só para quem pode excluir)            */}
      {/* ------------------------------------------------------------ */}
      {canDelete ? (
      <div className="rounded-2xl border border-red-line/50 bg-red-soft/30 p-5">
        <div className="flex items-center gap-2.5 border-b border-red-line/40 pb-4">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-600 dark:text-red-400">
            <TriangleAlert className="size-4" />
          </div>
          <div>
            <h4 className="font-display text-sm font-bold text-ink">Zona de risco</h4>
            <p className="text-xs text-muted">Ações daqui não podem ser desfeitas.</p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-ink">Excluir esta caixa de entrada</p>
            <p className="mt-0.5 text-[11px] text-muted">
              A conexão do WhatsApp é encerrada e as conversas e mensagens desta caixa são apagadas
              junto. Os contatos permanecem na conta.
            </p>
          </div>

          <Button
            type="button"
            variant="danger"
            size="sm"
            icon={<Trash2 className="size-3.5" />}
            onClick={() => setIsDeleteOpen(true)}
            className="shrink-0"
          >
            Excluir caixa
          </Button>
        </div>
      </div>
      ) : null}

      <DeleteInboxModal
        open={isDeleteOpen}
        connection={connection}
        onClose={() => setIsDeleteOpen(false)}
        onDeleted={onDeleted}
      />

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
  extra,
}: {
  readonly title: string;
  readonly description: string;
  readonly value: { readonly enabled: boolean; readonly text: string };
  readonly onChange: (value: { readonly enabled: boolean; readonly text: string }) => void;
  readonly placeholder: string;
  readonly id: string;
  /** Ajuste próprio da regra (o prazo da mensagem de espera, por exemplo). */
  readonly extra?: React.ReactNode;
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

        {extra ? <div className="mt-3">{extra}</div> : null}
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
