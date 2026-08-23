/**
 * Serialização CSV.
 *
 * Duas armadilhas resolvidas aqui, porque nenhuma das duas é óbvia no lugar de
 * uso:
 *
 * 1. **Injeção de fórmula.** Excel e Google Sheets executam qualquer célula que
 *    comece com `=`, `+`, `-`, `@`, tab ou CR. Um contato chamado
 *    `=HYPERLINK("http://ataque","clique")` viraria código no computador de
 *    quem abrisse o relatório. O apóstrofo à frente neutraliza a fórmula sem
 *    alterar o texto que a pessoa lê.
 * 2. **BOM.** Sem ele o Excel no Windows lê UTF-8 como Latin-1 e todo acento do
 *    relatório aparece quebrado.
 */

const BOM = String.fromCharCode(0xfeff);
const RISKY_PREFIX = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\n\r;]/;
const DIACRITICS = /\p{M}/gu;

const escapeCell = (value: string | number | undefined | null): string => {
  if (value === undefined || value === null) return '';

  const raw = String(value);
  const guarded = RISKY_PREFIX.test(raw) ? `'${raw}` : raw;

  return NEEDS_QUOTES.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
};

export interface CsvColumn<T> {
  readonly header: string;
  readonly value: (row: T) => string | number | undefined;
}

/**
 * `;` como separador: é o que o Excel em português espera, e evita que o
 * arquivo abra com tudo espremido numa coluna só.
 */
export const toCsv = <T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string => {
  const header = columns.map((column) => escapeCell(column.header)).join(';');
  const body = rows.map((row) =>
    columns.map((column) => escapeCell(column.value(row))).join(';'),
  );
  return BOM + [header, ...body].join('\r\n') + '\r\n';
};

/** Nome de arquivo seguro: sem acento, sem espaço, sem separador de caminho. */
export const csvFileName = (parts: readonly string[]): string =>
  `${parts
    .join('-')
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .replace(/[^A-Za-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()}.csv`;
