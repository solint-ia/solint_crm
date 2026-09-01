import type {
  AgentPerformance,
  AnalyticsReport,
  ComparisonRow,
  ConversionRate,
  CsatBucket,
  CsatComment,
  DashboardOverview,
  FunnelStageSummary,
  Kpi,
  LossReason,
  PendingConversation,
  PeriodKey,
  TimeSeriePoint,
} from '@/core/domain/analytics';
import {
  averageOf,
  bucketIndexOf,
  durationLabel,
  periodWindow,
  type PeriodWindow,
} from '@/core/domain/analytics-period';
import { CSAT_MAX, CSAT_MIN, CSAT_TONES, csatLabel, csatTone } from '@/core/domain/csat';
import type { Id } from '@/core/domain/shared';
import type { InboxAccess } from '@/core/domain/user';
import type { AnalyticsRepository } from '@/core/ports/analytics-repository';
import { prisma } from '@/infrastructure/db/prisma';

/**
 * Os números do painel, calculados a partir do que aconteceu.
 *
 * **O que havia aqui antes.** Tempo de primeira resposta era a string
 * `'1m 15s'`; tempo de resolução era `'18m'`; CSAT era `'4,9'` quando existia
 * alguma conversa resolvida e `'5,0'` quando não existia nenhuma — ou seja, a
 * conta vazia exibia a nota máxima. As variações (`-18% vs anterior`, `Dentro
 * da meta`, `98% satisfação`) eram texto fixo. A série do gráfico vinha de um
 * gerador pseudoaleatório de demonstração, escalado pelo total de conversas. O
 * desempenho por agente repetia `'1m 20s'` e `'4,9'` para toda a equipe. E o
 * seletor de período não entrava em nenhuma consulta: a busca de conversas não
 * tinha recorte de data nenhum.
 *
 * **O que ele faz agora.** Uma consulta recortada pela janela do período (mais
 * a janela anterior, para a comparação), e todo indicador derivado das colunas
 * que o atendimento agora carimba: `createdAt`, `firstResponseSecs`,
 * `resolutionSecs` e `csatScore`. Onde não há dado, o valor é `—` e a legenda
 * diz que não há — nunca um número inventado que pareça bom.
 */

/** Uma conversa, reduzida ao que qualquer indicador precisa dela. */
interface Linha {
  readonly id: string;
  readonly status: string;
  readonly channel: string;
  readonly priority: string;
  readonly unreadCount: number;
  readonly assigneeId: string | null;
  readonly assigneeName: string | null;
  readonly slaBreached: boolean | null;
  readonly createdAt: Date;
  readonly firstResponseSecs: number | null;
  readonly resolutionSecs: number | null;
  readonly resolvedAt: Date | null;
  readonly csatScore: number | null;
  readonly csatComment: string | null;
  readonly lastActivityAt: Date | null;
  readonly lastMessageAt: string;
  readonly contact: { readonly name: string; readonly phone: string };
}

const LINHA_SELECT = {
  id: true,
  status: true,
  channel: true,
  priority: true,
  unreadCount: true,
  assigneeId: true,
  assigneeName: true,
  slaBreached: true,
  createdAt: true,
  firstResponseSecs: true,
  resolutionSecs: true,
  resolvedAt: true,
  csatScore: true,
  csatComment: true,
  lastActivityAt: true,
  lastMessageAt: true,
  contact: { select: { name: true, phone: true } },
} as const;

const defined = (values: readonly (number | null)[]): number[] =>
  values.filter((value): value is number => value !== null && Number.isFinite(value));

/**
 * A variação entre duas janelas, já como texto e direção.
 *
 * `lowerIsBetter` inverte o julgamento sem inverter o sinal: uma queda de 20%
 * no tempo de resposta é `-20%` **e** é boa. Sem base anterior não há
 * percentual — "novo no período" é a resposta honesta, e é diferente de +100%.
 */
const variacao = (
  current: number | undefined,
  previous: number | undefined,
  lowerIsBetter = false,
): { readonly delta: string; readonly deltaDirection: Kpi['deltaDirection'] } => {
  if (current === undefined) return { delta: 'sem dados no período', deltaDirection: 'neutro' };
  if (previous === undefined || previous === 0) {
    return {
      delta: current === 0 ? 'sem dados no período' : 'novo no período',
      deltaDirection: 'neutro',
    };
  }

  const percentual = ((current - previous) / previous) * 100;
  const arredondado = Math.round(percentual * 10) / 10;
  if (arredondado === 0) return { delta: 'estável', deltaDirection: 'neutro' };

  const melhor = lowerIsBetter ? arredondado < 0 : arredondado > 0;
  const sinal = arredondado > 0 ? '+' : '';
  return {
    delta: `${sinal}${arredondado.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% vs. anterior`,
    deltaDirection: melhor ? 'positivo' : 'negativo',
  };
};

const plural = (count: number, singular: string, pluralWord: string): string =>
  `${count} ${count === 1 ? singular : pluralWord}`;

export class PrismaAnalyticsRepository implements AnalyticsRepository {
  /**
   * Lê as duas janelas de uma vez.
   *
   * Uma consulta só, cobrindo do começo da janela anterior até agora: o
   * comparativo precisa das duas, e duas idas ao banco pelo mesmo intervalo
   * contíguo não compram nada.
   */
  private async carregar(
    accountId: Id,
    inboxAccess: InboxAccess,
    window: PeriodWindow,
  ): Promise<{ readonly atual: Linha[]; readonly anterior: Linha[] }> {
    const linhas = (await prisma.conversation.findMany({
      // O recorte por caixa vale aqui como vale na lista. Sem ele, um agente da
      // Recepção leria no painel a contagem de atendimentos da Cobrança — não o
      // conteúdo, mas o volume, o tempo de resposta e quem atendeu. É menos
      // óbvio que ver a conversa, e vaza a mesma informação.
      where: {
        accountId,
        ...(inboxAccess === 'todas' ? {} : { inboxId: { in: [...inboxAccess] } }),
        createdAt: { gte: window.previousFrom, lte: window.to },
      },
      select: LINHA_SELECT,
      orderBy: { createdAt: 'asc' },
    })) as Linha[];

    const corte = window.from.getTime();
    return {
      atual: linhas.filter((linha) => linha.createdAt.getTime() >= corte),
      anterior: linhas.filter((linha) => linha.createdAt.getTime() < corte),
    };
  }

  /**
   * O funil da conta: o marcado como padrão, ou o primeiro que existir.
   *
   * O filtro era só `isDefault: true`, e nenhuma das duas telas que **criam**
   * funis garante essa marca — o Kanban lista todos, sem preferir nenhum. Uma
   * conta com dois funis e nenhum marcado via o painel dizer que não há funil
   * nenhum, com dez negócios cadastrados do lado.
   */
  private funilDaConta(accountId: Id) {
    const include = {
      stages: { include: { deals: { where: { accountId } } }, orderBy: { order: 'asc' as const } },
    };
    return prisma.pipeline
      .findFirst({ where: { accountId, isDefault: true }, include })
      .then(
        (padrao) =>
          padrao ??
          prisma.pipeline.findFirst({ where: { accountId }, include, orderBy: { name: 'asc' } }),
      );
  }

  async getOverview(
    accountId: Id,
    period: PeriodKey,
    inboxAccess: InboxAccess,
  ): Promise<DashboardOverview> {
    const window = periodWindow(period);

    /**
     * A fila **agora**, sem recorte de período.
     *
     * "Conversas abertas" e "sem responsável" são estado do presente, não
     * contagem da janela: uma conversa de três semanas atrás que ninguém
     * assumiu continua sendo um problema hoje, e sumiria do indicador se ele só
     * olhasse os últimos sete dias.
     *
     * Contagens vêm por `count`/`aggregate`, não por trazer as linhas e medir o
     * array. A fila em aberto não tem teto — ela cresce com a conta —, e uma
     * conta com dez mil conversas paradas carregaria dez mil registros com
     * contato embutido a cada abertura do painel para exibir três números. A
     * lista de "precisa de atenção" mostra oito; buscar trinta dá folga para o
     * filtro sem trazer o histórico junto.
     */
    const filaBase = {
      accountId,
      ...(inboxAccess === 'todas' ? {} : { inboxId: { in: [...inboxAccess] } }),
      status: { in: ['aberta', 'pendente', 'espera'] },
    };

    const [
      { atual, anterior },
      members,
      defaultPipeline,
      naFila,
      abertas,
      semResponsavel,
      naoLidas,
      conversasNaoLidas,
      candidatas,
    ] = await Promise.all([
      this.carregar(accountId, inboxAccess, window),
      prisma.membership.findMany({
        where: { accountId },
        include: { user: { include: { teamMemberships: { include: { team: true } } } } },
      }),
      this.funilDaConta(accountId),
      prisma.conversation.count({ where: filaBase }),
      prisma.conversation.count({ where: { ...filaBase, status: 'aberta' } }),
      prisma.conversation.count({ where: { ...filaBase, assigneeId: null } }),
      prisma.conversation.aggregate({ where: filaBase, _sum: { unreadCount: true } }),
      prisma.conversation.count({ where: { ...filaBase, unreadCount: { gt: 0 } } }),
      prisma.conversation.findMany({
        where: {
          ...filaBase,
          // Só quem de fato precisa de atenção: sem dono, com mensagem não lida,
          // com SLA estourado, ou parada em espera.
          OR: [
            { assigneeId: null },
            { unreadCount: { gt: 0 } },
            { slaBreached: true },
            { status: 'espera' },
          ],
        },
        select: LINHA_SELECT,
        orderBy: { lastActivityAt: 'asc' },
        take: 30,
      }) as Promise<Linha[]>,
    ]);

    const totalNaoLidas = naoLidas._sum.unreadCount ?? 0;

    const resolvidasAtual = atual.filter((linha) => linha.status === 'resolvida');
    const resolvidasAnterior = anterior.filter((linha) => linha.status === 'resolvida');

    const tprAtual = averageOf(defined(atual.map((linha) => linha.firstResponseSecs)));
    const tprAnterior = averageOf(defined(anterior.map((linha) => linha.firstResponseSecs)));
    const tmrAtual = averageOf(defined(resolvidasAtual.map((linha) => linha.resolutionSecs)));
    const tmrAnterior = averageOf(defined(resolvidasAnterior.map((linha) => linha.resolutionSecs)));

    const notasAtual = defined(atual.map((linha) => linha.csatScore));
    const csatAtual = averageOf(notasAtual);
    const satisfeitos = notasAtual.filter((nota) => nota >= 4).length;

    const kpis: Kpi[] = [
      {
        id: 'abertas',
        label: 'Conversas abertas',
        value: String(abertas),
        delta:
          naFila === abertas
            ? 'toda a fila está aberta'
            : `${naFila} na fila ao todo`,
        deltaDirection: abertas > 0 ? 'neutro' : 'positivo',
        description:
          'Atendimentos com status "aberta" neste exato momento, somando todas as caixas que você alcança. Não depende do período selecionado: é o estado atual da fila.',
      },
      {
        id: 'sem-responsavel',
        label: 'Sem responsável',
        value: String(semResponsavel),
        delta:
          semResponsavel === 0
            ? 'tudo atribuído'
            : plural(semResponsavel, 'aguardando dono', 'aguardando dono'),
        deltaDirection: semResponsavel > 0 ? 'negativo' : 'positivo',
        description:
          'Conversas ainda na fila que nenhum atendente assumiu. É o número que mede risco de abandono: ninguém está responsável por respondê-las.',
      },
      {
        id: 'nao-lidas',
        label: 'Mensagens não lidas',
        value: String(totalNaoLidas),
        delta:
          totalNaoLidas === 0
            ? 'caixa zerada'
            : `em ${plural(conversasNaoLidas, 'conversa', 'conversas')}`,
        deltaDirection: totalNaoLidas > 0 ? 'negativo' : 'positivo',
        description:
          'Total de mensagens enviadas por clientes que ninguém abriu ainda. Zera conforme a equipe lê as conversas.',
      },
      {
        id: 'tpr',
        label: 'Tempo 1ª resposta',
        value: durationLabel(tprAtual),
        ...variacao(tprAtual, tprAnterior, true),
        description:
          'Média do intervalo entre a abertura da conversa e a primeira resposta de um atendente humano, dentro do período. Saudação e demais mensagens automáticas não contam, porque sairiam em segundos e mascarariam o indicador.',
      },
      {
        id: 'tmr',
        label: 'Tempo de resolução',
        value: durationLabel(tmrAtual),
        ...variacao(tmrAtual, tmrAnterior, true),
        description:
          'Média do tempo entre a abertura e o encerramento das conversas resolvidas no período. Conversas ainda abertas não entram na conta.',
      },
      {
        id: 'csat',
        label: 'Índice CSAT',
        value: csatLabel(csatAtual),
        ...(notasAtual.length === 0
          ? { delta: 'sem avaliações', deltaDirection: 'neutro' as const }
          : {
              delta: `${Math.round((satisfeitos / notasAtual.length) * 100)}% satisfeitos · ${plural(notasAtual.length, 'nota', 'notas')}`,
              deltaDirection: (csatAtual ?? 0) >= 4 ? ('positivo' as const) : ('negativo' as const),
            }),
        description:
          'Média das notas de 1 a 5 que os clientes responderam à pesquisa de satisfação, no período. A pesquisa é enviada no encerramento e precisa estar ligada nas configurações da caixa. Sem respostas, o índice fica em branco em vez de exibir um valor de exemplo.',
      },
    ];

    /* ---------------------------------------------------------------- */
    /* Conversas que precisam de atenção — as mais paradas primeiro.     */
    /* ---------------------------------------------------------------- */
    const agora = Date.now();
    const pendings: PendingConversation[] = candidatas
      .slice(0, 8)
      .map((linha) => {
        const parado = linha.lastActivityAt
          ? Math.round((agora - linha.lastActivityAt.getTime()) / 1000)
          : undefined;
        const priority = (linha.priority as PendingConversation['priority']) || 'baixa';

        return {
          conversationId: linha.id,
          contactName: linha.contact.name || 'Contato sem nome',
          ...(linha.contact.phone ? { phone: linha.contact.phone } : {}),
          channel: linha.channel,
          ...(linha.assigneeName ? { assigneeName: linha.assigneeName } : {}),
          priority,
          // O rótulo era `lastMessageAt` — a hora do relógio ("14:32"), que não
          // responde "há quanto tempo isto está parado?".
          waitingLabel: parado === undefined ? 'agora' : `há ${durationLabel(parado)}`,
          ...(parado === undefined ? {} : { waitingMinutes: Math.round(parado / 60) }),
          tone: !linha.assigneeId
            ? ('amber' as const)
            : linha.slaBreached || priority === 'urgente'
              ? ('red' as const)
              : ('blue' as const),
        };
      });

    /* ---------------------------------------------------------------- */
    /* Desempenho por agente — no período, com os tempos reais dele.     */
    /* ---------------------------------------------------------------- */
    const agents = this.desempenhoPorAgente(accountId, members, atual);

    /* ---------------------------------------------------------------- */
    /* Funil comercial.                                                  */
    /* ---------------------------------------------------------------- */
    const funnel: FunnelStageSummary[] = (defaultPipeline?.stages ?? []).map((stage, index, todos) => {
      const proxima = todos[index + 1];
      // A conversão é quanto do que chegou aqui seguiu adiante. Sem próxima
      // etapa não há conversão a medir — a última etapa é o destino.
      const taxa =
        proxima && stage.deals.length > 0
          ? `${Math.round((proxima.deals.length / stage.deals.length) * 100)}%`
          : undefined;

      return {
        stage: stage.name,
        count: stage.deals.length,
        amountInCents: stage.deals.reduce((total, deal) => total + deal.amountInCents, 0),
        colorVar: stage.color || 'var(--color-blue-text)',
        ...(taxa ? { conversionRate: taxa } : {}),
      };
    });

    /* ---------------------------------------------------------------- */
    /* Série temporal — contagem real por balde.                         */
    /* ---------------------------------------------------------------- */
    const volume = this.serie(window, atual);

    return { kpis, volume, agents, funnel, pendings };
  }

  /**
   * Um ponto por balde do período, contado a partir das conversas.
   *
   * `answered`, `resolved` e `abandoned` eram frações fixas do total (92%, 85%,
   * 4%) — três linhas que nunca podiam se cruzar porque eram a mesma linha
   * multiplicada. Agora cada uma conta o que de fato aconteceu: quem foi
   * respondida, quem foi resolvida, e quem passou do período sem nenhuma
   * resposta.
   */
  private serie(window: PeriodWindow, linhas: readonly Linha[]): TimeSeriePoint[] {
    const pontos = window.buckets.map((bucket) => ({
      label: bucket.label,
      value: 0,
      answered: 0,
      resolved: 0,
      abandoned: 0,
    }));

    for (const linha of linhas) {
      const index = bucketIndexOf(window, linha.createdAt);
      const ponto = pontos[index];
      if (!ponto) continue;

      ponto.value += 1;
      if (linha.firstResponseSecs !== null) ponto.answered += 1;
      else if (linha.status !== 'aberta' && linha.status !== 'pendente') ponto.abandoned += 1;
      if (linha.status === 'resolvida') ponto.resolved += 1;
    }

    return pontos;
  }

  private desempenhoPorAgente(
    accountId: Id,
    members: readonly {
      readonly userId: string;
      readonly user: {
        readonly name: string;
        readonly avatarTone: string | null;
        readonly teamMemberships: readonly { readonly team: { readonly accountId: string; readonly name: string } }[];
      };
    }[],
    linhas: readonly Linha[],
  ): AgentPerformance[] {
    return members
      .map((member) => {
        const minhas = linhas.filter((linha) => linha.assigneeId === member.userId);
        const resolvidas = minhas.filter((linha) => linha.status === 'resolvida');
        const notas = defined(minhas.map((linha) => linha.csatScore));
        const media = averageOf(notas);

        // Só as equipes desta conta: a mesma pessoa pode atender em outra
        // empresa, e o nome da equipe de lá não descreve o trabalho dela aqui.
        const equipes = member.user.teamMemberships
          .filter((link) => link.team.accountId === accountId)
          .map((link) => link.team.name);

        return {
          id: member.userId,
          name: member.user.name,
          team: equipes[0] || 'Atendimento Geral',
          avatarTone: member.user.avatarTone || 'var(--color-brand)',
          handled: minhas.length,
          resolved: resolvidas.length,
          // A média era `'1m 20s'` para todo mundo — o ranking existia e não
          // rankeava nada.
          averageResponse: durationLabel(averageOf(defined(minhas.map((l) => l.firstResponseSecs)))),
          csat: csatLabel(media),
          csatTone: csatTone(media),
        };
      })
      .toSorted((a, b) => b.handled - a.handled || a.name.localeCompare(b.name));
  }

  async getReport(
    accountId: Id,
    period: PeriodKey,
    inboxAccess: InboxAccess,
  ): Promise<AnalyticsReport> {
    const window = periodWindow(period);
    const [{ atual, anterior }, members, defaultPipeline] = await Promise.all([
      this.carregar(accountId, inboxAccess, window),
      prisma.membership.findMany({
        where: { accountId },
        include: { user: { include: { teamMemberships: { include: { team: true } } } } },
      }),
      this.funilDaConta(accountId),
    ]);

    /**
     * A janela anterior desenhada com os mesmos rótulos da atual.
     *
     * O gráfico sobrepõe as duas curvas; se cada uma trouxesse o próprio eixo,
     * "Seg" da linha de cima e "Seg" da de baixo estariam em posições
     * diferentes e a comparação visual seria falsa.
     */
    const janelaAnterior: PeriodWindow = {
      ...window,
      from: window.previousFrom,
      to: window.previousTo,
      buckets: window.buckets.map((bucket) => ({
        label: bucket.label,
        from: new Date(bucket.from.getTime() - (window.from.getTime() - window.previousFrom.getTime())),
        to: new Date(bucket.to.getTime() - (window.from.getTime() - window.previousFrom.getTime())),
      })),
    };

    const resolvidasAtual = atual.filter((linha) => linha.status === 'resolvida');
    const resolvidasAnterior = anterior.filter((linha) => linha.status === 'resolvida');
    const notasAtual = defined(atual.map((linha) => linha.csatScore));
    const notasAnterior = defined(anterior.map((linha) => linha.csatScore));

    const comparison: ComparisonRow[] = [
      {
        id: 'conversas',
        label: 'Conversas recebidas',
        current: atual.length,
        previous: anterior.length,
      },
      {
        id: 'resolvidas',
        label: 'Conversas resolvidas',
        current: resolvidasAtual.length,
        previous: resolvidasAnterior.length,
      },
      {
        id: 'primeira_resposta',
        label: 'Tempo de 1ª resposta',
        current: Math.round(averageOf(defined(atual.map((l) => l.firstResponseSecs))) ?? 0),
        previous: Math.round(averageOf(defined(anterior.map((l) => l.firstResponseSecs))) ?? 0),
        unit: 's',
        lowerIsBetter: true,
      },
      {
        id: 'resolucao',
        label: 'Tempo de resolução',
        current: Math.round((averageOf(defined(resolvidasAtual.map((l) => l.resolutionSecs))) ?? 0) / 60),
        previous: Math.round((averageOf(defined(resolvidasAnterior.map((l) => l.resolutionSecs))) ?? 0) / 60),
        unit: 'min',
        lowerIsBetter: true,
      },
      {
        id: 'csat',
        label: 'CSAT médio',
        current: Math.round((averageOf(notasAtual) ?? 0) * 10) / 10,
        previous: Math.round((averageOf(notasAnterior) ?? 0) * 10) / 10,
        decimals: 1,
      },
      {
        id: 'sem_resposta',
        label: 'Conversas sem resposta',
        current: atual.filter((linha) => linha.firstResponseSecs === null).length,
        previous: anterior.filter((linha) => linha.firstResponseSecs === null).length,
        lowerIsBetter: true,
      },
    ];

    /* ---------------------------------------------------------------- */
    /* Funil: conversão etapa a etapa e onde os negócios se perdem.      */
    /* ---------------------------------------------------------------- */
    const etapas = defaultPipeline?.stages ?? [];
    const conversions: ConversionRate[] = etapas.slice(0, -1).map((stage, index) => {
      const proxima = etapas[index + 1];
      const taxa = stage.deals.length > 0 ? ((proxima?.deals.length ?? 0) / stage.deals.length) * 100 : 0;

      // O tempo médio parado na etapa sai do próprio negócio: quanto faz que
      // ele entrou nela e ainda não saiu. `enteredStageAt` é texto ISO gravado
      // na movimentação; o que não for data legível fica de fora da média em
      // vez de virar `NaN` e contaminar o resultado inteiro.
      const dias = averageOf(
        stage.deals
          .map((deal) => Date.parse(deal.enteredStageAt))
          .filter((instante) => Number.isFinite(instante))
          .map((instante) => (Date.now() - instante) / (24 * 60 * 60 * 1000)),
      );

      return {
        stage: `${stage.name} → ${proxima?.name ?? 'fim'}`,
        rate: stage.deals.length === 0 ? '—' : `${Math.round(taxa)}%`,
        average: dias === undefined ? '—' : `${dias.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`,
      };
    });

    /**
     * Onde os negócios param.
     *
     * A lista de "motivos de perda" era fixa e inventada ("Preço", "Prazo",
     * "Concorrência"), porque o sistema não pergunta o motivo em lugar nenhum.
     * O que ele de fato sabe é **em qual etapa** os negócios estão parados — e
     * essa é a informação verdadeira equivalente.
     */
    const totalNegocios = etapas.reduce((total, stage) => total + stage.deals.length, 0);
    const lossReasons: LossReason[] = etapas
      .filter((stage) => stage.deals.length > 0)
      .map((stage) => ({
        reason: `Parados em ${stage.name}`,
        percentage: totalNegocios > 0 ? Math.round((stage.deals.length / totalNegocios) * 100) : 0,
      }))
      .toSorted((a, b) => b.percentage - a.percentage)
      .slice(0, 6);

    /* ---------------------------------------------------------------- */
    /* CSAT: distribuição real das notas e os comentários que vieram.    */
    /* ---------------------------------------------------------------- */
    const csatDistribution: CsatBucket[] = Array.from(
      { length: CSAT_MAX - CSAT_MIN + 1 },
      (_, index) => {
        const stars = CSAT_MAX - index;
        const quantas = notasAtual.filter((nota) => nota === stars).length;
        return {
          stars,
          percentage: notasAtual.length === 0 ? 0 : Math.round((quantas / notasAtual.length) * 100),
          tone: CSAT_TONES[stars] ?? 'slate',
        };
      },
    );

    const csatComments: CsatComment[] = atual
      .filter((linha) => linha.csatScore !== null && linha.csatComment)
      .slice(0, 12)
      .map((linha) => ({
        id: linha.id,
        contactName: linha.contact.name || 'Contato sem nome',
        stars: linha.csatScore ?? 0,
        comment: linha.csatComment ?? '',
      }));

    return {
      volume: this.serie(window, atual),
      previousVolume: this.serie(janelaAnterior, anterior),
      comparison,
      agents: this.desempenhoPorAgente(accountId, members, atual),
      conversions,
      lossReasons,
      csatDistribution,
      csatComments,
      csatResponseCount: notasAtual.length,
    };
  }
}
