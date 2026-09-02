// Sem `server-only` de propósito: o script de carga do banco (`prisma/seed.ts`)
// roda fora do Next e precisa deste módulo. A importação de `node:crypto` já
// impede que ele vá parar num bundle de cliente.
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { MIN_PASSWORD_LENGTH } from '@/core/domain/user';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Hash de senha com `scrypt`.
 *
 * `scrypt` vem do `node:crypto` — sem dependência externa — e é uma função
 * deliberadamente cara em CPU e memória, que é exatamente o que se quer contra
 * força bruta. Cada senha tem sal próprio, então duas pessoas com a mesma
 * senha produzem hashes diferentes e uma rainbow table não serve para nada.
 *
 * Formato guardado: `scrypt$<sal em hex>$<hash em hex>`. O prefixo permite
 * trocar o algoritmo depois sem adivinhar o formato do que já está no banco.
 */

const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
};

/**
 * Comparação em tempo constante: comparar com `===` vazaria o número de bytes
 * corretos pelo tempo de resposta.
 */
export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;

  try {
    const expected = Buffer.from(hashHex, 'hex');
    const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
};

/**
 * Regra mínima de senha.
 *
 * Comprimento acima de tudo: uma frase longa resiste mais que oito caracteres
 * com símbolo obrigatório, e regras de composição só empurram as pessoas para
 * `Senha@123`.
 *
 * O mínimo vem de `MIN_PASSWORD_LENGTH`, no domínio, porque os formulários de
 * cliente precisam do mesmo número e não podem importar este módulo.
 */
export const passwordProblem = (password: string): string | undefined => {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `A senha precisa de pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (password.length > 200) return 'A senha é longa demais.';
  if (!/[a-zA-Z]/.test(password)) return 'A senha precisa conter ao menos uma letra.';
  if (!/\d/.test(password)) return 'A senha precisa conter ao menos um número.';
  return undefined;
};
