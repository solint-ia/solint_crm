import { compareRow, PERIOD_LABELS, PREVIOUS_PERIOD_LABELS } from '@/core/domain/analytics';
import { can } from '@/core/domain/user';
import { container } from '@/infrastructure/container';
import { csvFileName, toCsv, type CsvColumn } from '@/lib/csv';
import { parseOneOf, parsePeriod } from '@/lib/search-params';
import { writeAuditLog } from '@/infrastructure/audit/write-audit-log';

export const dynamic = 'force-dynamic';

const TABS = ['conversas', 'agentes', 'funil', 'csat', 'comparativo'] as const;
type ExportTab = (typeof TABS)[number];

const TAB_FILE_LABEL: Readonly<Record<ExportTab, string>> = {
  conversas: 'volume-de-conversas',
  agentes: 'desempenho-por-agente',
  funil: 'funil-e-perdas',
  csat: 'satisfacao',
  comparativo: 'comparativo-de-periodos',
};

const number = (value: number, decimals = 0): string =>
  value.toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

/**
 * Exportação de relatório em CSV (§13).
 *
 * Roda no servidor, e não no navegador, por três motivos: a autorização é
 * verificada onde não dá para burlar, o arquivo sai com os mesmos números que
 * a tela leu do domínio, e o `Content-Disposition` faz o download acontecer
 * sem depender de truque de link no cliente.
 */
export async function GET(request: Request) {
  const session = await container.session.getSession();
  if (!session) return new Response('Não autenticado.', { status: 401 });
  if (!can(session, 'relatorios:ler')) {
    return new Response('Sem permissão para exportar relatórios.', { status: 403 });
  }

  const url = new URL(request.url);
  const period = parsePeriod(url.searchParams.get('periodo') ?? undefined);
  const tab: ExportTab = parseOneOf(url.searchParams.get('aba') ?? undefined, TABS, 'conversas');

  const report = await container.analytics.getReport(
    session.account.id,
    period,
    session.inboxAccess,
  );

  let csv: string;

  switch (tab) {
    case 'conversas': {
      // As duas janelas lado a lado: exportar só a atual perderia a referência.
      const rows = report.volume.map((point, index) => ({
        label: point.label,
        current: point.value,
        previous: report.previousVolume[index]?.value ?? 0,
      }));
      const columns: readonly CsvColumn<(typeof rows)[number]>[] = [
        { header: 'Período', value: (row) => row.label },
        { header: PERIOD_LABELS[period], value: (row) => row.current },
        { header: PREVIOUS_PERIOD_LABELS[period], value: (row) => row.previous },
        { header: 'Variação', value: (row) => row.current - row.previous },
      ];
      csv = toCsv(rows, columns);
      break;
    }

    case 'agentes':
      csv = toCsv(report.agents, [
        { header: 'Agente', value: (agent) => agent.name },
        { header: 'Atendimentos', value: (agent) => agent.handled },
        { header: 'Resolvidas', value: (agent) => agent.resolved ?? 0 },
        { header: 'CSAT', value: (agent) => agent.csat },
      ]);
      break;

    case 'funil': {
      const rows = [
        ...report.conversions.map((conversion) => ({
          bloco: 'Conversão entre etapas',
          item: conversion.stage,
          valor: conversion.rate,
          detalhe: conversion.average,
        })),
        ...report.lossReasons.map((reason) => ({
          bloco: 'Motivo de perda',
          item: reason.reason,
          valor: `${reason.percentage}%`,
          detalhe: '',
        })),
      ];
      csv = toCsv(rows, [
        { header: 'Bloco', value: (row) => row.bloco },
        { header: 'Item', value: (row) => row.item },
        { header: 'Valor', value: (row) => row.valor },
        { header: 'Detalhe', value: (row) => row.detalhe },
      ]);
      break;
    }

    case 'csat': {
      const rows = [
        ...report.csatDistribution.map((bucket) => ({
          bloco: 'Distribuição',
          item: `${bucket.stars} estrela${bucket.stars === 1 ? '' : 's'}`,
          valor: `${bucket.percentage}%`,
          detalhe: '',
        })),
        ...report.csatComments.map((comment) => ({
          bloco: 'Comentário',
          item: comment.contactName,
          valor: String(comment.stars),
          detalhe: comment.comment,
        })),
      ];
      csv = toCsv(rows, [
        { header: 'Bloco', value: (row) => row.bloco },
        { header: 'Item', value: (row) => row.item },
        { header: 'Valor', value: (row) => row.valor },
        { header: 'Detalhe', value: (row) => row.detalhe },
      ]);
      break;
    }

    case 'comparativo':
      csv = toCsv(report.comparison, [
        { header: 'Indicador', value: (row) => row.label },
        {
          header: PERIOD_LABELS[period],
          value: (row) => number(row.current, row.decimals ?? 0) + (row.unit ? ` ${row.unit}` : ''),
        },
        {
          header: PREVIOUS_PERIOD_LABELS[period],
          value: (row) =>
            number(row.previous, row.decimals ?? 0) + (row.unit ? ` ${row.unit}` : ''),
        },
        { header: 'Variação', value: (row) => compareRow(row).label },
        {
          header: 'Leitura',
          value: (row) => {
            const verdict = compareRow(row);
            return verdict.direction === 'positivo'
              ? 'melhorou'
              : verdict.direction === 'negativo'
                ? 'piorou'
                : 'estável';
          },
        },
      ]);
      break;
  }

  const fileName = csvFileName(['solint', TAB_FILE_LABEL[tab], period]);
  await writeAuditLog({
    accountId: session.account.id,
    actorId: session.user.id,
    actorName: session.user.name,
    action: 'dados.exportados',
    targetType: 'relatorio',
    targetName: TAB_FILE_LABEL[tab],
    metadata: { tab, period },
  });

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  });
}
