import type { Id } from './shared';

/** Paleta semântica disponível para etiquetas e badges (mapeada em tokens de tema). */
export const TONES = [
  'amber',
  'green',
  'red',
  'violet',
  'blue',
  'cyan',
  'slate',
  'pink',
  'indigo',
] as const;
export type Tone = (typeof TONES)[number] | (string & {});

/**
 * Um tom válido é um nome da paleta **ou** uma cor livre em hexadecimal.
 *
 * O tipo `Tone` já aceitava os dois, e o `Badge` já sabia pintar os dois — o
 * seletor de cor arrastável nasceu justamente para produzir a cor livre. Quem
 * ficou para trás foi a validação da Server Action, que exigia o nome da
 * paleta: escolher uma cor no seletor devolvia "Invalid enum value... received
 * '#578CE3'", e a etiqueta não salvava.
 *
 * A regra vive aqui, no domínio, e não no `zod` da action: são dois pontos que
 * validam tom (criar e editar), e a próxima forma de cor aceita — se um dia
 * houver — precisa valer nos dois sem ninguém ter de lembrar do segundo.
 *
 * A forma curta `#abc` entra porque o CSS a aceita e o seletor pode emiti-la.
 */
const HEX_COLOR = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

export const isValidTone = (value: string): boolean => {
  const tom = value.trim();
  return (TONES as readonly string[]).includes(tom) || HEX_COLOR.test(tom);
};

export interface Label {
  readonly id: Id;
  readonly accountId: Id;
  readonly name: string;
  readonly tone: Tone;
  readonly description?: string;
  readonly usageCount?: number;
}
