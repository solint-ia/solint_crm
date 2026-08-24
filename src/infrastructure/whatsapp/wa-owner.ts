import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import type { WhatsAppOwner } from './whatsapp-events';

/**
 * Quem pareou o número — gravado ao lado das credenciais da sessão.
 *
 * **Por que em arquivo, e por que isto é temporário.** O `accountId` das
 * mensagens recebidas vinha de `ACCOUNT_ID`, uma constante importada do seed:
 * toda mensagem real caía na conta de demonstração, qualquer que fosse a conta
 * de quem conectou. Tirar a constante exige saber a conta, e a conta só é
 * conhecida no momento do pareamento — que pode ter acontecido dias antes,
 * noutro processo.
 *
 * Guardar o dono junto de `creds.json` resolve isso com o mesmo ciclo de vida
 * da sessão: nasce no pareamento, morre na desconexão, sobrevive a reinício.
 *
 * Na Fase 3 este arquivo desaparece: o dono passa a ser uma coluna de
 * `WhatsAppConnection`, e a conta vem da `Inbox` — que é onde ela pertence
 * quando existe mais de uma conexão por conta.
 */

const OWNER_FILE = 'owner.json';

const filePath = (sessionsDir: string): string => path.join(sessionsDir, OWNER_FILE);

const isOwner = (value: unknown): value is WhatsAppOwner => {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row['userId'] === 'string' &&
    typeof row['userName'] === 'string' &&
    typeof row['accountId'] === 'string'
  );
};

/** Lê o dono salvo. `undefined` se não houver, estiver ilegível ou incompleto. */
export const readOwner = (sessionsDir: string): WhatsAppOwner | undefined => {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath(sessionsDir), 'utf-8'));
    // Versão antiga do arquivo não tinha `accountId`. Recusar é melhor do que
    // adivinhar a conta: adivinhar grava conversa de cliente no lugar errado.
    return isOwner(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export const writeOwner = async (sessionsDir: string, owner: WhatsAppOwner): Promise<void> => {
  try {
    await fsp.mkdir(sessionsDir, { recursive: true });
    await fsp.writeFile(filePath(sessionsDir), JSON.stringify(owner), 'utf-8');
  } catch (error) {
    console.error('[wa-owner] Falha ao gravar o dono da sessão:', error);
  }
};

export const clearOwner = async (sessionsDir: string): Promise<void> => {
  await fsp.rm(filePath(sessionsDir), { force: true }).catch(() => undefined);
};
