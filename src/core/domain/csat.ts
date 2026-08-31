import type { Tone } from './label';

/**
 * Satisfação do cliente — a escala, a leitura da resposta e a média.
 *
 * Mora no domínio, e não no adaptador de WhatsApp, por um motivo prático: a
 * tela de Configurações precisa da pergunta padrão para mostrá-la como
 * sugestão, e ela é um componente de cliente. Importar o módulo de infra levaria
 * o Prisma junto para o navegador.
 */

/** A escala é de 1 a 5. Não é configurável de propósito: CSAT comparável exige escala fixa. */
export const CSAT_MIN = 1;
export const CSAT_MAX = 5;

export const DEFAULT_CSAT_QUESTION =
  'Como você avalia este atendimento? Responda com um número de 1 a 5, sendo 5 a nota máxima.';

/**
 * Extrai uma nota de 1 a 5 do que o cliente escreveu.
 *
 * Aceita o número solto, o número com pontuação, "nota 4" e as estrelas — é o
 * que as pessoas de fato respondem. Uma frase que apenas contenha um dígito
 * ("meu pedido 3 chegou") não conta: a resposta tem que ser sobre a nota, e um
 * falso positivo aqui contamina permanentemente a média da equipe.
 */
export const parseCsatScore = (text: string): number | undefined => {
  const limpo = text.trim().toLowerCase();
  if (!limpo || limpo.length > 40) return undefined;

  const estrelas = (limpo.match(/⭐|★/g) ?? []).length;
  if (estrelas >= CSAT_MIN && estrelas <= CSAT_MAX) return estrelas;

  const match = /^(?:nota\s*)?([1-5])(?:\s*(?:\/\s*5|de\s*5|estrelas?|pontos?))?[.!]?$/.exec(limpo);
  return match ? Number(match[1]) : undefined;
};

/** Média das notas dadas. `undefined` quando ninguém avaliou — nunca zero. */
export const csatAverage = (scores: readonly number[]): number | undefined => {
  if (scores.length === 0) return undefined;
  return scores.reduce((total, score) => total + score, 0) / scores.length;
};

/**
 * Percentual de satisfeitos: notas 4 e 5 sobre o total.
 *
 * É a definição usual de CSAT, e é ela que o cartão do painel mostra como
 * legenda — a média sozinha esconde a diferença entre "todo mundo deu 4" e
 * "metade deu 5 e metade deu 3".
 */
export const csatSatisfactionRate = (scores: readonly number[]): number | undefined => {
  if (scores.length === 0) return undefined;
  return (scores.filter((score) => score >= 4).length / scores.length) * 100;
};

export const CSAT_TONES: Readonly<Record<number, Tone>> = {
  1: 'red',
  2: 'red',
  3: 'amber',
  4: 'green',
  5: 'green',
};

export const csatTone = (average: number | undefined): Tone =>
  average === undefined ? 'slate' : average >= 4 ? 'green' : average >= 3 ? 'amber' : 'red';

/** "4,7" no formato do produto; travessão quando não há nota nenhuma. */
export const csatLabel = (average: number | undefined): string =>
  average === undefined ? '—' : average.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
