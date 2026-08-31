import { WA_LOG_LEVEL } from './wa-log';

/**
 * Silencia o ruído que a `libsignal` escreve direto no console.
 *
 * A biblioteca de criptografia usada pelo Baileys não tem logger injetável: ela
 * chama `console.info`/`console.warn` diretamente (ver
 * `node_modules/libsignal/src/session_record.js`). E o que ela escreve não é
 * uma linha — é o **objeto de sessão inteiro**, com chaves públicas e privadas
 * despejadas como `<Buffer …>`:
 *
 * ```
 * Closing session: SessionEntry {
 *   _chains: { …
 *   currentRatchet: { ephemeralKeyPair: { pubKey: <Buffer 05 04 …>, privKey: <Buffer 30 77 …> } },
 * ```
 *
 * São vinte linhas por sessão fechada, e uma sessão é fechada toda vez que um
 * contato troca de aparelho ou reinstala o aplicativo. No log do Render isso
 * enterra o que importa — e, pior, **imprime material de chave privada** num
 * lugar que costuma ser compartilhado ao pedir ajuda.
 *
 * Nada aqui é diagnóstico perdido: são eventos normais do protocolo, que o
 * próprio Baileys já registra em `identity changed` quando o nível de log
 * permite. A partir de `WA_LOG_LEVEL=debug` o filtro sai da frente, porque aí
 * quem ligou o nível quer ver tudo.
 */

/** Prefixos das mensagens que a `libsignal` emite no curso normal do protocolo. */
const RUIDO_LIBSIGNAL: readonly string[] = [
  'Closing session:',
  'Opening session:',
  'Session already closed',
  'Session already open',
  'Removing old closed session:',
  'Migrating session to:',
  'Closing open session in favor of incoming prekey bundle',
  'Decrypted message with closed session.',
];

let aplicado = false;

export const silenceNoisyLibsignalLogs = (): void => {
  if (aplicado) return;
  // Só `trace` vê tudo. Nem mesmo `debug` liberta este ruído: o que ele
  // imprime junto é material de chave privada, e isso não é diagnóstico de
  // ninguém — quem precisa mesmo dele pede o nível máximo, de propósito.
  if (WA_LOG_LEVEL === 'trace') return;
  aplicado = true;

  for (const nivel of ['log', 'info', 'warn'] as const) {
    const original = console[nivel].bind(console);
    console[nivel] = (...args: unknown[]): void => {
      const primeiro = args[0];
      if (
        typeof primeiro === 'string' &&
        RUIDO_LIBSIGNAL.some((prefixo) => primeiro.startsWith(prefixo))
      ) {
        return;
      }
      original(...(args as [unknown]));
    };
  }
};
