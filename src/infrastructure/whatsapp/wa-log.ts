/**
 * Registro de diagnóstico do WhatsApp.
 *
 * Existe por uma razão concreta: o worker rodava com `pino({ level: 'silent' })`
 * e, por isso, uma saturação do keystore que atrasava os envios em minutos não
 * deixava rastro nenhum. Diagnosticar exigiu ler o banco por fora. Um canal de
 * log que se liga por variável de ambiente resolve isso sem encher o terminal
 * de quem só quer rodar o projeto.
 *
 * `WA_LOG_LEVEL` aceita `silent` (padrão), `warn`, `info`, `debug` e `trace`.
 * A partir de `debug` o próprio Baileys passa a registrar — inclusive falha de
 * decifra, que é a informação que separa "mensagem não chegou" de "mensagem
 * chegou e não pôde ser lida".
 */

export const WA_LOG_LEVELS = ['silent', 'warn', 'info', 'debug', 'trace'] as const;

export type WaLogLevel = (typeof WA_LOG_LEVELS)[number];

const RANK: Readonly<Record<WaLogLevel, number>> = {
  silent: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

const configured = (): WaLogLevel => {
  const raw = (process.env.WA_LOG_LEVEL ?? '').trim().toLowerCase();
  return (WA_LOG_LEVELS as readonly string[]).includes(raw) ? (raw as WaLogLevel) : 'silent';
};

/**
 * Nível corrente.
 *
 * Lido uma vez: trocar o nível exige reiniciar o worker, o que é aceitável e
 * evita uma leitura de `process.env` em todo log — e há muitos, no caminho
 * quente do keystore.
 */
export const WA_LOG_LEVEL: WaLogLevel = configured();

const enabled = (level: WaLogLevel): boolean => RANK[WA_LOG_LEVEL] >= RANK[level];

/**
 * Nível equivalente para o `pino` que o Baileys usa.
 *
 * `silent` é o padrão de propósito: o Baileys em `debug` é extremamente
 * verboso, e ligá-lo por acidente esconderia a saída do próprio worker.
 */
export const baileysLogLevel = (): string => WA_LOG_LEVEL;

export const waLog = {
  warn: (...args: unknown[]): void => {
    if (enabled('warn')) console.warn(...(args as [unknown]));
  },
  info: (...args: unknown[]): void => {
    if (enabled('info')) console.log(...(args as [unknown]));
  },
  debug: (...args: unknown[]): void => {
    if (enabled('debug')) console.log(...(args as [unknown]));
  },
  /**
   * Cronômetro para os trechos que precisamos medir sem adivinhar.
   *
   * Devolve uma função que registra a duração. Fora do nível `debug` ela é um
   * no-op e o `Date.now()` sequer é chamado.
   */
  timer: (rotulo: string): ((detalhe?: string) => void) => {
    if (!enabled('debug')) return () => undefined;
    const inicio = Date.now();
    return (detalhe?: string) => {
      const ms = Date.now() - inicio;
      console.log(`${rotulo}: ${ms}ms${detalhe ? ` — ${detalhe}` : ''}`);
    };
  },
};
