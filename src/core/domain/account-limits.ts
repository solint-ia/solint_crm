/**
 * Tetos que a plataforma impõe a uma conta.
 *
 * Puro de propósito: a Server Action que cria a caixa, a que cria o workspace
 * e o cartão do console decidem "chegou no limite?" com a mesma função, e a
 * frase que explica o bloqueio é escrita uma vez.
 *
 * `null` (ou ausente) é "sem limite", e não zero: zero é um teto legítimo,
 * que a plataforma pode usar para impedir que uma conta crie qualquer coisa.
 */

export const LIMIT_MAX = 1_000;

export const isLimitReached = (limit: number | null | undefined, current: number): boolean =>
  typeof limit === 'number' && current >= limit;

export const inboxLimitMessage = (limit: number): string =>
  limit === 0
    ? 'A plataforma não liberou a criação de caixas de entrada para esta conta.'
    : `Esta conta chegou ao limite de ${limit} ${limit === 1 ? 'caixa de entrada' : 'caixas de entrada'} definido pela plataforma. Fale com quem administra o Solint para ampliar.`;

export const workspaceLimitMessage = (limit: number): string =>
  limit === 0
    ? 'A plataforma não liberou a criação de workspaces a partir desta conta.'
    : `Esta conta chegou ao limite de ${limit} ${limit === 1 ? 'workspace' : 'workspaces'} criados a partir dela. Fale com quem administra o Solint para ampliar.`;

/**
 * Interpreta o que a pessoa digitou no console: vazio é "sem limite", número
 * inteiro entre 0 e `LIMIT_MAX` é o teto, e o resto é recusado com motivo.
 */
export const parseLimitInput = (
  raw: string,
):
  | { readonly ok: true; readonly value: number | null }
  | { readonly ok: false; readonly error: string } => {
  const texto = raw.trim();
  if (texto === '') return { ok: true, value: null };
  if (!/^\d+$/.test(texto))
    return { ok: false, error: 'Informe um número inteiro ou deixe vazio.' };
  const valor = Number(texto);
  if (valor > LIMIT_MAX) return { ok: false, error: `O limite máximo aceito é ${LIMIT_MAX}.` };
  return { ok: true, value: valor };
};
