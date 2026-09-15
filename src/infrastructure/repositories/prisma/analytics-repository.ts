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
  periodRangeLabel,
  periodWindow,
  type PeriodWindow,
} from '@/core/domain/analytics-period';
import { CSAT_MAX, CSAT_MIN, CSAT_TONES, csatLabel, csatTone } from '@/core/domain/csat';
import { asTimezone } from '@/core/domain/regional-preferences';
import type { Id } from '@/core/domain/shared';
import type { InboxAccess } from '@/core/domain/user';
import type { AnalyticsRepository } from '@/core/ports/analytics-repository';
import { prisma, readJson } from '@/infrastructure/db/prisma';

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
 * que o atendimento carimba. Onde não há dado, o valor é `—` e a legenda diz
 * que não há — nunca um número inventado que pareça bom.
 *
 * **Auditoria de setembro de 2026.** Cinco correções, cada uma anotada no ponto
 * em que mora: o recorte de dia no fuso da conta, e não no do servidor; as
 * conversas importadas do histórico fora da contagem de resolvidas; a conversão
 * do funil como fluxo, e não fotografia (passava de 100%); "abandonadas" sem as
 * conversas em espera; e a comparação que não inventa queda de 100% quando um
 * dos períodos não tem nenhuma nota.
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
  csatScore: true,
  csatComment: true,
  lastActivityAt: true,
  lastMessageAt: true,
  contact: { select: { name: true, phone: true } },
} as const;

/** Uma etapa do funil com os negócios que estão nela agora. */
interface EtapaDoFunil {
  readonly name: string;
  readonly color: string | null;
  readonly isWon: boolean;
  readonly isLost: boolean;
  readonly deals: readonly { readonly amountInCents: number; readonly enteredStageAt: string }[];
}

const defined = (values: readonly (number | null)[]): number[] =>
  values.filter((value): value is number => value !== null && Number.isFinite(value));

/** Um par atual/anterior de qualquer contagem. */
interface Par {
  readonly atual: number;
  readonly anterior: number;
}

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

/**
 * Variação de uma **taxa**, em pontos percentuais.
 *
 * Uma taxa de resolução que vai de 40% para 50% subiu 10 pontos, não 25%. A
 * variação relativa de uma porcentagem é a leitura que engana quem decide.
 */
const variacaoEmPontos = (
  current: number | undefined,
  previous: number | undefined,
): { readonly delta: string; readonly deltaDirection: Kpi['deltaDirection'] } => {
  if (current === undefined) return { delta: 'sem dados no período', deltaDirection: 'neutro' };
  if (previous === undefined) return { delta: 'novo no período', deltaDirection: 'neutro' };
  const pontos = Math.round(current) - Math.round(previous);
  if (pontos === 0) return { delta: 'estável', deltaDirection: 'neutro' };
  return {
    delta: `${pontos > 0 ? '+' : ''}${pontos} p.p. vs. anterior`,
    deltaDirection: pontos > 0 ? 'positivo' : 'negativo',
  };
};

const plural = (count: number, singular: string, pluralWord: string): string =>
  `${count} ${count === 1 ? singular : pluralWord}`;

/** Parte das conversas recebidas que já está resolvida. Sem conversas, sem taxa. */
const taxaDeResolucao = (linhas: readonly Linha[]): number | undefined =>
  linhas.length === 0
    ? undefined
    : (linhas.filter((linha) => linha.status === 'resolvida').length / linhas.length) * 100;

/** Média do tempo até a primeira resposta, só entre as conversas respondidas. */
const tempoMedioDeResposta = (linhas: readonly Linha[]): number | undefined =>
  averageOf(defined(linhas.map((linha) => linha.firstResponseSecs)));

/** O cartão de CSAT, igual no painel e no relatório. */
const kpiCsat = (notas: readonly number[]): Kpi => {
  const media = averageOf(notas);
  const satisfeitos = notas.filter((nota) => nota >= 4).length;
  return {
    id: 'csat',
    label: 'Índice CSAT',
    value: csatLabel(media),
    ...(notas.length === 0
      ? { delta: 'sem avaliações', deltaDirection: 'neutro' as const }
      : {
          delta: `${Math.round((satisfeitos / notas.length) * 100)}% satisfeitos · ${plural(notas.length, 'nota', 'notas')}`,
          deltaDirection: (media ?? 0) >= 4 ? ('positivo' as const) : ('negativo' as const),
        }),
    description:
      'Média das notas de 1 a 5 que os clientes responderam à pesquisa de satisfação, no período. A pesquisa é enviada no encerramento e precisa estar ligada nas configurações da caixa. Sem respostas, o índice fica em branco em vez de exibir um valor de exemplo.',
  };
};

/**
 * Quantos negócios chegaram **pelo menos** até cada etapa da escada.
 *
 * A conversão era o número de negócios parados na próxima etapa dividido pelo
 * número parado nesta. Isso é fotografia, não fluxo: com 2 negócios em Proposta
 * e 5 em Negociação, "Proposta → Negociação" dava 250%. Um negócio que está em
 * Negociação passou por Proposta, então quem chegou a uma etapa é quem está
 * nela ou em qualquer etapa adiante. Quem chama tira as etapas de perda antes:
 * um negócio perdido não avançou para lugar nenhum.
 */
const alcancadosPorEtapa = (escada: readonly EtapaDoFunil[]): number[] => {
  const alcancados = escada.map(() => 0);
  let acumulado = 0;
  for (let index = escada.length - 1; index >= 0; index -= 1) {
    acumulado += escada[index]?.deals.length ?? 0;
    alcancados[index] = acumulado;
  }
  return alcancados;
};

/** Conversão de uma etapa para a seguinte, em 0 a 100. Sem ninguém na etapa, sem taxa. */
const conversaoEntre = (alcancados: readonly number[], index: number): number | undefined => {
  const base = alcancados[index];
  const seguinte = alcancados[index + 1];
  if (base === undefined || seguinte === undefined || base === 0) return undefined;
  return (seguinte / base) * 100;
};

export class PrismaAnalyticsRepository implements AnalyticsRepository {
  /**
   * O fuso da conta, o mesmo em que a tela mostra as horas.
   *
   * O recorte usava o relógio do processo, e em produção o processo roda em
   * UTC: "Hoje" começava às 21h do dia anterior no horário de Brasília, e uma
   * conversa das 22h caía no dia seguinte do gráfico.
   */
  private async fusoDaConta(accountId: Id): Promise<string> {
    const settings = await prisma.accountSettings.findUnique({
      where: { accountId },
      select: { company: true },
    });
    return asTimezone(readJson<{ timezone?: string }>(settings?.company, {}).timezone);
  }

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
        importedAt: null,
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
   * O Comercial canônico da conta, com fallback para um padrão legado.
   * Funis automáticos de caixas antigas não entram no Dashboard.
   */
  private funilDaConta(accountId: Id) {
    const include = {
      stages: { include: { deals: { where: { accountId } } }, orderBy: { order: 'asc' as const } },
    };
    return prisma.pipeline
      .findFirst({ where: { id: `pip-${accountId}`, accountId }, include })
      .then(
        (canonico) =>
          canonico ??
          prisma.pipeline.findFirst({
            where: {
              accountId,
              isDefault: true,
              NOT: { id: { startsWith: 'pip-ibx-' } },
            },
            include,
          }),
      )
      .then(
        (padrao) =>
          padrao ??
          prisma.pipeline.findFirst({
            where: { accountId, NOT: { id: { startsWith: 'pip-ibx-' } } },
            include,
            orderBy: { name: 'asc' },
          }),
      );
  }

  /**
   * Quantas conversas foram encerradas em cada janela.
   *
   * A data relevante é `resolvedAt`, não `createdAt`: uma conversa aberta na
   * semana passada e resolvida hoje pertence à produção de hoje.
   *
   * `importedAt: null` pelo mesmo motivo de `carregar`: uma conversa trazida do
   * histórico do WhatsApp não é trabalho da equipe no período. Sem o filtro, a
   * contagem de resolvidas somava importações que a de recebidas já excluía, e
   * as duas deixavam de ser comparáveis.
   */
  private async contarResolvidas(
    accountId: Id,
    inboxAccess: InboxAccess,
    window: PeriodWindow,
  ): Promise<Par> {
    const scope = inboxAccess === 'todas' ? {} : { inboxId: { in: [...inboxAccess] } };

    const [atual, anterior] = await Promise.all([
      prisma.conversation.count({
        where: {
          accountId,
          importedAt: null,
          ...scope,
          resolvedAt: { gte: window.from, lte: window.to },
        },
      }),
      prisma.conversation.count({
        where: {
          accountId,
          importedAt: null,
          ...scope,
          resolvedAt: { gte: window.previousFrom, lte: window.previousTo },
        },
      }),
    ]);

    return { atual, anterior };
  }

  /**
   * Mensagens trocadas em cada janela, pela data da própria mensagem.
   *
   * Contagem no banco, e não carregando linhas: volume de mensagens é a métrica
   * que mais cresce numa conta. Ficam de fora notas internas (não saíram para o
   * cliente), avisos do sistema (ninguém escreveu) e o que veio da importação
   * de histórico (não aconteceu no período, só chegou ao CRM nele).
   */
  private async contarMensagens(
    accountId: Id,
    inboxAccess: InboxAccess,
    window: PeriodWindow,
  ): Promise<{ readonly recebidas: Par; readonly enviadas: Par }> {
    const conversation = {
      accountId,
      ...(inboxAccess === 'todas' ? {} : { inboxId: { in: [...inboxAccess] } }),
    };
    const base = (from: Date, to: Date) => ({
      conversation,
      isPrivate: false,
      createdAt: { gte: from, lte: to },
      OR: [{ origin: null }, { origin: { not: 'historico' } }],
    });

    const [recebidaAtual, enviadaAtual, recebidaAnterior, enviadaAnterior] = await Promise.all([
      prisma.message.count({ where: { ...base(window.from, window.to), author: 'contact' } }),
      prisma.message.count({
        where: { ...base(window.from, window.to), author: { in: ['agent', 'ai'] } },
      }),
      prisma.message.count({
        where: { ...base(window.previousFrom, window.previousTo), author: 'contact' },
      }),
      prisma.message.count({
        where: {
          ...base(window.previousFrom, window.previousTo),
          author: { in: ['agent', 'ai'] },
        },
      }),
    ]);

    return {
      recebidas: { atual: recebidaAtual, anterior: recebidaAnterior },
      enviadas: { atual: enviadaAtual, anterior: enviadaAnterior },
    };
  }

  async getOverview(
    accountId: Id,
    period: PeriodKey,
    inboxAccess: InboxAccess,
  ): Promise<DashboardOverview> {
    const window = periodWindow(period, new Date(), await this.fusoDaConta(accountId));

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
      ...(inboxAccess === 'todas' ? {} : { inboxId: { in: [...inboxAccess] } }),
      status: { in: ['aberta', 'pendente', 'espera'] },
    };

    const [
      { atual, anterior },
      resolvidas,
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
      this.contarResolvidas(accountId, inboxAccess, window),
      prisma.membership.findMany({
        where: { accountId },
        include: { user: { include: { teamMemberships: { include: { team: true } } } } },
      }),
      this.funilDaConta(accountId),
      prisma.conversation.count({ where: { accountId, ...filaBase } }),
      prisma.conversation.count({ where: { accountId, ...filaBase, status: 'aberta' } }),
      prisma.conversation.count({ where: { accountId, ...filaBase, assigneeId: null } }),
      prisma.conversation.aggregate({
        where: { accountId, ...filaBase },
        _sum: { unreadCount: true },
      }),
      prisma.conversation.count({ where: { accountId, ...filaBase, unreadCount: { gt: 0 } } }),
      prisma.conversation.findMany({
        where: {
          accountId,
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
    const notasAtual = defined(atual.map((linha) => linha.csatScore));

    const kpis: Kpi[] = [
      {
        id: 'abertas',
        label: 'Conversas abertas',
        value: String(abertas),
        delta: naFila === abertas ? 'toda a fila está aberta' : `${naFila} na fila ao todo`,
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
        id: 'recebidas',
        label: 'Conversas recebidas',
        value: String(atual.length),
        ...variacao(atual.length, anterior.length),
        description:
          'Conversas que começaram no período selecionado, comparadas com a janela imediatamente anterior. Mede o volume novo que chegou para a equipe.',
      },
      {
        id: 'resolvidas',
        label: 'Resolvidas no período',
        value: String(resolvidas.atual),
        ...variacao(resolvidas.atual, resolvidas.anterior),
        description:
          'Conversas efetivamente encerradas no período, mesmo que tenham sido abertas antes dele. Mede quanto trabalho a equipe concluiu.',
      },
      kpiCsat(notasAtual),
    ];

    /* ---------------------------------------------------------------- */
    /* Conversas que precisam de atenção — as mais paradas primeiro.     */
    /* ---------------------------------------------------------------- */
    const agora = Date.now();
    const pendings: PendingConversation[] = candidatas.slice(0, 8).map((linha) => {
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
    const etapas: readonly EtapaDoFunil[] = defaultPipeline?.stages ?? [];
    const escada = etapas.filter((stage) => !stage.isLost);
    const alcancados = alcancadosPorEtapa(escada);

    const funnel: FunnelStageSummary[] = etapas.map((stage) => {
      // A última etapa da escada é o destino, e etapa de perda não converte
      // para nada: nas duas não há taxa a mostrar.
      const taxa = conversaoEntre(alcancados, escada.indexOf(stage));
      return {
        stage: stage.name,
        count: stage.deals.length,
        amountInCents: stage.deals.reduce((total, deal) => total + deal.amountInCents, 0),
        colorVar: stage.color || 'var(--color-blue-text)',
        ...(!stage.isLost && taxa !== undefined ? { conversionRate: `${Math.round(taxa)}%` } : {}),
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
   * respondida, quem foi resolvida, e quem foi encerrada sem nenhuma resposta.
   *
   * "Abandonada" é só a resolvida sem resposta. Contava também a conversa em
   * espera, que é trabalho em andamento com a equipe aguardando o cliente, e
   * não desistência de ninguém.
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
      else if (linha.status === 'resolvida') ponto.abandoned += 1;
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
        readonly teamMemberships: readonly {
          readonly team: { readonly accountId: string; readonly name: string };
        }[];
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
    const fuso = await this.fusoDaConta(accountId);
    const window = periodWindow(period, new Date(), fuso);
    const [{ atual, anterior }, resolvidas, mensagens, members, defaultPipeline] =
      await Promise.all([
        this.carregar(accountId, inboxAccess, window),
        this.contarResolvidas(accountId, inboxAccess, window),
        this.contarMensagens(accountId, inboxAccess, window),
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
    const deslocamento = window.from.getTime() - window.previousFrom.getTime();
    const janelaAnterior: PeriodWindow = {
      ...window,
      from: window.previousFrom,
      to: window.previousTo,
      buckets: window.buckets.map((bucket) => ({
        label: bucket.label,
        from: new Date(bucket.from.getTime() - deslocamento),
        to: new Date(bucket.to.getTime() - deslocamento),
      })),
    };

    const notasAtual = defined(atual.map((linha) => linha.csatScore));
    const notasAnterior = defined(anterior.map((linha) => linha.csatScore));
    const taxaAtual = taxaDeResolucao(atual);
    const taxaAnterior = taxaDeResolucao(anterior);
    const tmrAtual = tempoMedioDeResposta(atual);
    const tmrAnterior = tempoMedioDeResposta(anterior);
    const mensagensAtual = mensagens.recebidas.atual + mensagens.enviadas.atual;
    const mensagensAnterior = mensagens.recebidas.anterior + mensagens.enviadas.anterior;

    /* ---------------------------------------------------------------- */
    /* Resumo executivo: os seis números que abrem o relatório.          */
    /* ---------------------------------------------------------------- */
    const summary: Kpi[] = [
      {
        id: 'recebidas',
        label: 'Atendimentos recebidos',
        value: String(atual.length),
        ...variacao(atual.length, anterior.length),
        description:
          'Conversas que começaram no período, sem contar as trazidas da importação de histórico do WhatsApp.',
      },
      {
        id: 'resolvidas',
        label: 'Resolvidos no período',
        value: String(resolvidas.atual),
        ...variacao(resolvidas.atual, resolvidas.anterior),
        description:
          'Conversas encerradas dentro do período, mesmo as que começaram antes dele. Mede o trabalho concluído.',
      },
      {
        id: 'taxa-resolucao',
        label: 'Taxa de resolução',
        value: taxaAtual === undefined ? '—' : `${Math.round(taxaAtual)}%`,
        ...variacaoEmPontos(taxaAtual, taxaAnterior),
        description:
          'Das conversas que começaram no período, quantas já estão resolvidas. A variação é em pontos percentuais: de 40% para 50% são 10 pontos.',
      },
      {
        id: 'tmr',
        label: 'Tempo médio de 1ª resposta',
        value: durationLabel(tmrAtual),
        ...variacao(tmrAtual, tmrAnterior, true),
        description:
          'Média do tempo entre a primeira mensagem do cliente e a primeira resposta pública da equipe, só entre as conversas do período que foram respondidas. Cair é melhorar.',
      },
      {
        id: 'mensagens',
        label: 'Mensagens trocadas',
        value: mensagensAtual.toLocaleString('pt-BR'),
        ...(mensagensAtual === 0 && mensagensAnterior === 0
          ? { delta: 'sem mensagens no período', deltaDirection: 'neutro' as const }
          : {
              delta: `${mensagens.recebidas.atual.toLocaleString('pt-BR')} recebidas · ${mensagens.enviadas.atual.toLocaleString('pt-BR')} enviadas`,
              deltaDirection: 'neutro' as const,
            }),
        description:
          'Mensagens enviadas por clientes e pela equipe (inclusive agentes de IA) no período. Notas internas, avisos do sistema e histórico importado ficam de fora.',
      },
      kpiCsat(notasAtual),
    ];

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
        current: resolvidas.atual,
        previous: resolvidas.anterior,
      },
      {
        id: 'taxa_resolucao',
        label: 'Taxa de resolução',
        current: Math.round(taxaAtual ?? 0),
        previous: Math.round(taxaAnterior ?? 0),
        format: 'percentual',
        ...(taxaAtual === undefined ? { currentMissing: true } : {}),
        ...(taxaAnterior === undefined ? { previousMissing: true } : {}),
      },
      {
        id: 'tmr',
        label: 'Tempo médio de 1ª resposta',
        current: Math.round(tmrAtual ?? 0),
        previous: Math.round(tmrAnterior ?? 0),
        format: 'duracao',
        lowerIsBetter: true,
        ...(tmrAtual === undefined ? { currentMissing: true } : {}),
        ...(tmrAnterior === undefined ? { previousMissing: true } : {}),
      },
      {
        id: 'mensagens_recebidas',
        label: 'Mensagens recebidas',
        current: mensagens.recebidas.atual,
        previous: mensagens.recebidas.anterior,
      },
      {
        id: 'mensagens_enviadas',
        label: 'Mensagens enviadas',
        current: mensagens.enviadas.atual,
        previous: mensagens.enviadas.anterior,
      },
      {
        id: 'csat',
        label: 'CSAT médio',
        current: Math.round((averageOf(notasAtual) ?? 0) * 10) / 10,
        previous: Math.round((averageOf(notasAnterior) ?? 0) * 10) / 10,
        decimals: 1,
        ...(notasAtual.length === 0 ? { currentMissing: true } : {}),
        ...(notasAnterior.length === 0 ? { previousMissing: true } : {}),
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
    const etapas: readonly EtapaDoFunil[] = defaultPipeline?.stages ?? [];
    const escada = etapas.filter((stage) => !stage.isLost);
    const alcancados = alcancadosPorEtapa(escada);

    const conversions: ConversionRate[] = escada.slice(0, -1).map((stage, index) => {
      const proxima = escada[index + 1];
      const taxa = conversaoEntre(alcancados, index);

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
        rate: taxa === undefined ? '—' : `${Math.round(taxa)}%`,
        average:
          dias === undefined
            ? '—'
            : `${dias.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`,
      };
    });

    /**
     * Onde os negócios param.
     *
     * A lista de "motivos de perda" era fixa e inventada ("Preço", "Prazo",
     * "Concorrência"), porque o sistema não pergunta o motivo em lugar nenhum.
     * O que ele de fato sabe é **em qual etapa** os negócios estão parados — e
     * essa é a informação verdadeira equivalente.
     *
     * A etapa de ganho fica de fora: negócio fechado não está parado, e aparecia
     * no topo da lista como se fosse o maior gargalo do funil.
     */
    const totalNegocios = etapas.reduce((total, stage) => total + stage.deals.length, 0);
    const lossReasons: LossReason[] = etapas
      .filter((stage) => !stage.isWon && stage.deals.length > 0)
      .map((stage) => ({
        reason: stage.isLost ? `Perdidos em ${stage.name}` : `Parados em ${stage.name}`,
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
      rangeLabel: periodRangeLabel(window.from, window.to, fuso),
      previousRangeLabel: periodRangeLabel(window.previousFrom, window.previousTo, fuso),
      summary,
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
