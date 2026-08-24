import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // Recomendado para AES-GCM
const KEY_BYTES = 32; // AES-256 requer chave de 32 bytes

/**
 * Validação rigorosa da chave de criptografia no carregamento do módulo.
 *
 * Se a chave estiver ausente ou com tamanho inválido, o sistema falha imediatamente
 * no boot (Fail Fast), impedindo erros silenciosos em tempo de execução no meio de um atendimento.
 */
const readKey = (): Buffer => {
  const key = Buffer.from(process.env.WA_ENCRYPTION_KEY ?? '', 'base64url');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `[WhatsApp Crypto] WA_ENCRYPTION_KEY precisa ter exatamente ${KEY_BYTES} bytes em base64url (recebido: ${key.length} bytes).`,
    );
  }
  return key;
};

const KEY = readKey();

export interface SealedData {
  readonly cipher: Buffer;
  readonly iv: Buffer;
  readonly tag: Buffer;
}

/**
 * Cifra um buffer com AES-256-GCM.
 * Gera um IV aleatório exclusivo para cada operação de gravação.
 */
export const seal = (plain: Buffer): SealedData => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { cipher: body, iv, tag: cipher.getAuthTag() };
};

/**
 * Decifra um buffer com AES-256-GCM verificando a tag de autenticação.
 * Lança erro se o dado tiver sido alterado ou corrompido.
 */
export const open = (cipher: Buffer, iv: Buffer, tag: Buffer): Buffer => {
  const decipher = createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(cipher), decipher.final()]);
};
