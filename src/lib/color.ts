/**
 * Conversões de cor para o seletor visual.
 *
 * HSV e não HSL porque é o modelo que o quadro arrastável desenha: a área 2D é
 * literalmente saturação no eixo X e valor no eixo Y, com a matiz escolhida à
 * parte. Em HSL a mesma área precisaria de correção não linear para o gradiente
 * bater com a cor resultante, e o ponteiro pararia longe de onde o olho espera.
 *
 * Funções puras, sem `document` nem `window`: dá para testá-las sem navegador, e
 * elas rodam igual no servidor durante a hidratação.
 */

export interface Hsv {
  /** Matiz em graus, 0 a 360. */
  readonly h: number;
  /** Saturação, 0 a 1. */
  readonly s: number;
  /** Valor (brilho), 0 a 1. */
  readonly v: number;
}

const clamp = (valor: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, valor));

const doisDigitos = (valor: number): string =>
  Math.round(clamp(valor, 0, 255))
    .toString(16)
    .padStart(2, '0');

/** `#RRGGBB` em maiúsculas a partir de HSV. */
export const hsvToHex = ({ h, s, v }: Hsv): string => {
  const matiz = ((h % 360) + 360) % 360;
  const saturacao = clamp(s, 0, 1);
  const valor = clamp(v, 0, 1);

  const c = valor * saturacao;
  const x = c * (1 - Math.abs(((matiz / 60) % 2) - 1));
  const m = valor - c;

  const setor = Math.floor(matiz / 60) % 6;
  const [r, g, b] = (
    [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ] as const
  )[setor] ?? [0, 0, 0];

  return `#${doisDigitos((r + m) * 255)}${doisDigitos((g + m) * 255)}${doisDigitos((b + m) * 255)}`.toUpperCase();
};

/**
 * HSV a partir de `#RRGGBB`.
 *
 * Cor sem saturação (cinza, branco, preto) não tem matiz definida
 * matematicamente. Devolver 0 ali faria o ponteiro da faixa de matiz saltar
 * para o vermelho toda vez que alguém arrastasse o brilho até o preto — por
 * isso quem chama pode preservar a matiz anterior.
 */
export const hexToHsv = (hex: string): Hsv => {
  const limpo = hex.replace('#', '');
  const r = parseInt(limpo.slice(0, 2), 16) / 255;
  const g = parseInt(limpo.slice(2, 4), 16) / 255;
  const b = parseInt(limpo.slice(4, 6), 16) / 255;

  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return { h: 217, s: 0.76, v: 0.96 };

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }

  return { h: (h + 360) % 360, s: max === 0 ? 0 : delta / max, v: max };
};
