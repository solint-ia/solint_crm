import type { Session } from '../domain/user';

/**
 * Porta de sessão: quem entrega o usuário/conta corrente.
 * A implementação real (cookie assinado + backend) fica na infraestrutura.
 */
export interface SessionProvider {
  /**
   * Sessão do usuário autenticado. Quando não há sessão, a implementação
   * decide o desvio (redirecionar para o login) — as telas não precisam tratar
   * o caso nulo em cada chamada.
   */
  getCurrentSession(): Promise<Session>;
  /**
   * Igual ao anterior, mas devolve `null` em vez de desviar.
   * É o que rotas de API usam para responder 401 em vez de um redirecionamento
   * que um cliente HTTP não saberia interpretar.
   */
  getSession(): Promise<Session | null>;
}
