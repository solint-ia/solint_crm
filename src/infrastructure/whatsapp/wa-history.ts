import type { WAMessage } from '@whiskeysockets/baileys';
import { isSupportedChatJid } from './wa-identity';

/** Conversas sincronizadas em paralelo no histórico inicial. */
const DEFAULT_CONCURRENCY = 4;

/**
 * Sincroniza o histórico recebido no pareamento/reconexão.
 *
 * Antes cada caminho fazia um `for` com `await` sobre a lista inteira. Cada
 * mensagem custa mais de dez idas ao banco, então algumas centenas de mensagens
 * viravam minutos de sincronização — e enquanto durava, o resto da aplicação
 * disputava o mesmo pool de conexões.
 *
 * O agrupamento por conversa é o que torna o paralelismo seguro. Dentro de uma
 * conversa a ordem importa: cada mensagem atualiza a mesma linha de
 * `Conversation`, e `lastActivityAt`/`unreadCount` precisam terminar no valor
 * certo. Entre conversas diferentes não existe relação nenhuma, e elas podem
 * avançar juntas — com um teto baixo, para não esgotar o pool e deixar as telas
 * esperando por conexão.
 *
 * Uma mensagem que falhe não interrompe as demais: histórico é recuperação de
 * estado, e perder uma linha antiga é muito melhor que abortar a sincronização.
 */
export const syncHistoryMessages = async (
  messages: readonly WAMessage[],
  handle: (msg: WAMessage) => Promise<void>,
  options: { concurrency?: number; onError?: (err: unknown) => void } = {},
): Promise<void> => {
  const { concurrency = DEFAULT_CONCURRENCY, onError } = options;

  const byChat = new Map<string, WAMessage[]>();
  for (const msg of messages) {
    if (!msg.message || !isSupportedChatJid(msg.key.remoteJid)) continue;
    const bucket = byChat.get(msg.key.remoteJid);
    if (bucket) bucket.push(msg);
    else byChat.set(msg.key.remoteJid, [msg]);
  }

  const chats = [...byChat.values()];
  let cursor = 0;

  const drain = async (): Promise<void> => {
    while (cursor < chats.length) {
      const chat = chats[cursor];
      cursor += 1;
      if (!chat) continue;
      for (const msg of chat) {
        try {
          await handle(msg);
        } catch (err) {
          onError?.(err);
        }
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, chats.length) }, drain));
};
