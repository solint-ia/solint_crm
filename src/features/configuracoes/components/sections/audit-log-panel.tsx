'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Download, Search, Shield } from 'lucide-react';
import {
  AUDIT_ACTION_LABELS,
  AUDIT_CRITICAL_ACTIONS,
  auditGroupOf,
  type AuditRecord,
} from '@/core/domain/audit';
import { auditLogExportAction } from '@/app/(workspace)/configuracoes/audit-actions';
import { useFormatarData } from '@/components/layout/date-format-provider';
import { Button } from '@/components/ui/button';
import { toCsv, csvFileName } from '@/lib/csv';
import { cn } from '@/lib/cn';

type Tab = 'tudo' | 'atendimento' | 'administrativas' | 'seguranca' | 'criticas';

interface DisplayRecord extends AuditRecord {
  readonly count?: number;
  readonly lastAt?: string;
}

/**
 * O dia da linha, no formato que a empresa escolheu.
 *
 * "hoje" e "ontem" vêm antes da data porque são o que responde a pergunta de
 * quem abre a auditoria. Da antevéspera em diante, a data absoluta respeita
 * `company.dateFormat` como o resto do produto — antes era `pt-BR` fixo, e a
 * preferência não chegava a lugar nenhum.
 */
const dayLabelCom = (iso: string, formatar: (date: Date | string) => string): string => {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return 'hoje';
  if (date.toDateString() === yesterday.toDateString()) return 'ontem';
  return formatar(date);
};

/** Chave de agrupamento: precisa ser estável, então não usa o formato da conta. */
const dayKey = (iso: string): string => new Date(iso).toDateString();

const groupedMessages = (records: readonly AuditRecord[], detailed: boolean): DisplayRecord[] => {
  if (detailed) return [...records];
  const output: DisplayRecord[] = [];
  const groups = new Map<string, DisplayRecord>();
  for (const record of records) {
    if (record.action !== 'mensagem.enviada') {
      output.push(record);
      continue;
    }
    const key = `${dayKey(record.createdAt)}:${record.actorId}:${record.targetId ?? ''}`;
    const existing = groups.get(key);
    if (existing) {
      groups.set(key, { ...existing, count: (existing.count ?? 1) + 1, lastAt: record.createdAt });
    } else {
      const first = { ...record, count: 1 };
      groups.set(key, first);
      output.push(first);
    }
  }
  return output.map((record) =>
    record.action === 'mensagem.enviada'
      ? (groups.get(`${dayKey(record.createdAt)}:${record.actorId}:${record.targetId ?? ''}`) ??
        record)
      : record,
  );
};

export function AuditLogPanel({ records }: { readonly records: readonly AuditRecord[] }) {
  const formatarData = useFormatarData();
  const [tab, setTab] = useState<Tab>('tudo');
  const [query, setQuery] = useState('');
  const [actorId, setActorId] = useState('');
  const [action, setAction] = useState('');
  const [conversationId, setConversationId] = useState('');

  const actors = useMemo(
    () => [...new Map(records.map((record) => [record.actorId, record.actorName])).entries()],
    [records],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt-BR');
    const selected = records.filter((record) => {
      const group = auditGroupOf(record.action);
      if (tab === 'atendimento' && group !== 'atendimento') return false;
      if (tab === 'administrativas' && group !== 'administrativas') return false;
      if (tab === 'seguranca' && group !== 'seguranca') return false;
      if (tab === 'criticas' && !AUDIT_CRITICAL_ACTIONS.includes(record.action)) return false;
      if (actorId && record.actorId !== actorId) return false;
      if (action && record.action !== action) return false;
      if (
        conversationId &&
        record.targetId !== conversationId &&
        record.metadata.conversationId !== conversationId
      )
        return false;
      if (!needle) return true;
      return `${record.actorName} ${record.targetName ?? ''} ${record.action}`
        .toLocaleLowerCase('pt-BR')
        .includes(needle);
    });
    return groupedMessages(selected, Boolean(conversationId));
  }, [records, tab, query, actorId, action, conversationId]);

  const exportCsv = async () => {
    await auditLogExportAction({ count: filtered.length });
    const csv = toCsv(filtered, [
      { header: 'Data', value: (row) => new Date(row.createdAt).toLocaleString('pt-BR') },
      { header: 'Pessoa', value: (row) => row.actorName },
      { header: 'Ação', value: (row) => AUDIT_ACTION_LABELS[row.action] },
      { header: 'Alvo', value: (row) => row.targetName ?? row.targetId },
      { header: 'IP', value: (row) => row.ip },
    ]);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = csvFileName(['auditoria', new Date().toISOString().slice(0, 10)]);
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="rounded-2xl border border-line bg-surface p-6 shadow-2xs">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
        <div>
          <h3 className="font-display text-base font-bold text-ink">Registro de auditoria</h3>
          <p className="text-xs text-muted">Ações da equipe nos últimos 7 dias.</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<Download className="size-3.5" />}
          onClick={exportCsv}
        >
          Exportar CSV
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap gap-1">
        {(
          [
            ['tudo', 'Tudo'],
            ['atendimento', 'Atendimento'],
            ['administrativas', 'Administrativas'],
            ['seguranca', 'Segurança'],
            ['criticas', 'Críticas'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'rounded-control px-3 py-1.5 text-xs font-semibold',
              tab === id ? 'bg-brand text-white' : 'bg-surface-2 text-muted hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="relative">
          <Search className="absolute left-2.5 top-2.5 size-3.5 text-dim" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar…"
            className="w-full rounded-control border border-line bg-surface-2 py-2 pl-8 pr-2 text-xs text-ink"
          />
        </label>
        <select
          value={actorId}
          onChange={(event) => setActorId(event.target.value)}
          className="rounded-control border border-line bg-surface-2 px-2 text-xs text-ink"
        >
          <option value="">Todas as pessoas</option>
          {actors.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={action}
          onChange={(event) => setAction(event.target.value)}
          className="rounded-control border border-line bg-surface-2 px-2 text-xs text-ink"
        >
          <option value="">Todas as ações</option>
          {Object.entries(AUDIT_ACTION_LABELS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <input
          value={conversationId}
          onChange={(event) => setConversationId(event.target.value)}
          placeholder="ID da conversa"
          className="rounded-control border border-line bg-surface-2 px-2 text-xs text-ink"
        />
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted">Nenhuma ação registrada no período.</p>
        ) : (
          filtered.map((record) => {
            const critical = AUDIT_CRITICAL_ACTIONS.includes(record.action);
            return (
              <div
                key={record.id}
                className={cn(
                  'flex gap-3 rounded-xl border p-3 text-xs',
                  critical
                    ? 'border-amber-500/40 bg-amber-500/10'
                    : 'border-line-soft bg-surface-2/50',
                )}
              >
                {critical ? (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                ) : (
                  <Shield className="mt-0.5 size-4 shrink-0 text-dim" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-ink">
                    <strong>{record.actorName}</strong>{' '}
                    {record.count && record.count > 1
                      ? `enviou ${record.count} mensagens em`
                      : AUDIT_ACTION_LABELS[record.action]}{' '}
                    <strong>{record.targetName ?? record.targetId ?? record.targetType}</strong>
                  </p>
                  <p className="mt-1 text-[11px] text-dim">
                    {dayLabelCom(record.createdAt, formatarData)} ·{' '}
                    {new Date(record.createdAt).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {record.ip ? ` · IP ${record.ip}` : ''}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
