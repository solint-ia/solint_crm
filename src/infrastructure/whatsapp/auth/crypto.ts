import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // Recomendado para AES-GCM
const KEY_BYTES = 32; // AES-256 requer chave de 32 bytes

/**
 * Validação rigorosa da chave de criptografia no carregamento do módulo.
 *
 * Se a chave estiver ausente ou com tamanho inválido, o sistema falha imediatamente
 * no boot (Fail Fast), impedindo erros silenciosos em tempo de execução no meio de um atendimento.
 */
const decodeKey = (encoded: string, name: string): Buffer => {
  const key = Buffer.from(encoded, 'base64url');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `[WhatsApp Crypto] ${name} precisa ter exatamente ${KEY_BYTES} bytes em base64url (recebido: ${key.length} bytes).`,
    );
  }
  return key;
};

const keyId = (key: Buffer): string => createHash('sha256').update(key).digest('hex').slice(0, 16);
const currentKey = decodeKey(process.env.WA_ENCRYPTION_KEY ?? '', 'WA_ENCRYPTION_KEY');
const previousKeys = (process.env.WA_ENCRYPTION_KEY_PREVIOUS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value, index) => decodeKey(value, `WA_ENCRYPTION_KEY_PREVIOUS[${index}]`));
const keyring = new Map([currentKey, ...previousKeys].map((key) => [keyId(key), key]));

export interface SealedData {
  readonly cipher: Buffer;
  readonly iv: Buffer;
  readonly tag: Buffer;
  readonly keyId: string;
}

/**
 * Cifra um buffer com AES-256-GCM.
 * Gera um IV aleatório exclusivo para cada operação de gravação.
 */
export const seal = (plain: Buffer, aad?: string): SealedData => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, currentKey, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { cipher: body, iv, tag: cipher.getAuthTag(), keyId: keyId(currentKey) };
};

/**
 * Decifra um buffer com AES-256-GCM verificando a tag de autenticação.
 * Lança erro se o dado tiver sido alterado ou corrompido.
 */
export const open = (
  cipher: Buffer,
  iv: Buffer,
  tag: Buffer,
  options: { readonly aad?: string; readonly keyId?: string | null } = {},
): Buffer => {
  const keys = options.keyId
    ? [keyring.get(options.keyId)].filter((key): key is Buffer => Boolean(key))
    : [...keyring.values()];
  if (keys.length === 0) throw new Error(`Chave de criptografia ${options.keyId} não disponível.`);

  let lastError: unknown;
  for (const key of keys) {
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      if (options.aad) decipher.setAAD(Buffer.from(options.aad));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(cipher), decipher.final()]);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Não foi possível decifrar o dado.');
};
