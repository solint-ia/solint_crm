import { jwtVerify, SignJWT } from 'jose';

/**
 * Emissão e verificação do token de sessão.
 *
 * Este módulo **não toca no banco** de propósito: ele roda também no
 * middleware, que executa no runtime Edge — onde não há socket TCP e portanto
 * não há Prisma. A consequência é uma divisão clara de responsabilidade:
 *
 *   - aqui verifica-se a **assinatura e a validade** do token (barato, Edge);
 *   - em `session.ts` verifica-se a **revogação** contra o banco (autoritativo).
 *
 * Um token roubado continua assinado e válido; só a checagem no banco derruba
 * a sessão. Por isso o middleware é um portão, não a autorização final.
 */

export const SESSION_COOKIE = 'solint_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface SessionClaims {
  /** Id do usuário. */
  readonly sub: string;
  /** Conta (workspace) em que a sessão foi aberta. */
  readonly act: string;
  /** Identificador do token, conferido contra a tabela de sessões. */
  readonly jti: string;
  /**
   * Atuação de plataforma: esta sessão é o superadministrador operando dentro
   * da conta `act`, sem vínculo com ela.
   *
   * **A reivindicação diz em qual conta, nunca se pode.** Ela é só o endereço;
   * a autoridade vem de `readSession()` reler `User.isSuperAdmin` do banco a
   * cada requisição. Um token forjado com este campo preenchido é inútil contra
   * um usuário sem a marca, e tirar a marca corta o acesso no mesmo instante,
   * sem esperar a sessão expirar.
   *
   * Opcional para que todo token já emitido continue valendo: campo ausente
   * significa sessão comum, que é o que eles são.
   */
  readonly sa?: true;
}

const encoder = new TextEncoder();

/**
 * Em desenvolvimento um segredo ausente vira um valor fixo com aviso, para que
 * clonar o repositório e rodar `npm run dev` funcione. Em produção é erro:
 * subir com segredo previsível é o mesmo que não ter autenticação.
 */
const secretKey = (): Uint8Array => {
  const secret = process.env.AUTH_SECRET;
  if (secret && secret.length >= 32) return encoder.encode(secret);

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'AUTH_SECRET ausente ou curto demais (mínimo 32 caracteres). Defina-o antes de subir.',
    );
  }
  console.warn(
    '[auth] AUTH_SECRET ausente — usando segredo de desenvolvimento. Não use isto em produção.',
  );
  return encoder.encode('solint-desenvolvimento-somente-nao-use-em-producao');
};

export const signSessionToken = async (claims: SessionClaims): Promise<string> =>
  new SignJWT({ act: claims.act, ...(claims.sa ? { sa: true } : {}) })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setJti(claims.jti)
    .setIssuedAt()
    .setIssuer('solint-crm')
    .setAudience('solint-crm')
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());

/** Devolve `null` para qualquer token inválido, expirado ou malformado. */
export const verifySessionToken = async (token: string): Promise<SessionClaims | null> => {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: 'solint-crm',
      audience: 'solint-crm',
      algorithms: ['HS256'],
    });

    const { sub, jti, act, sa } = payload;
    if (typeof sub !== 'string' || typeof jti !== 'string' || typeof act !== 'string') {
      return null;
    }
    // Só o literal `true` conta. Qualquer outro valor no lugar (uma string, um
    // número, um objeto) é token adulterado, e o tratamento é ignorá-lo: a
    // sessão vira comum, que é o modo sem privilégio.
    return { sub, jti, act, ...(sa === true ? { sa: true as const } : {}) };
  } catch {
    // Assinatura inválida, expirado, emissor errado: tudo é "não autenticado".
    return null;
  }
};
