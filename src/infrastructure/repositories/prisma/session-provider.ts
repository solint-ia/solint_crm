import { redirect } from 'next/navigation';
import type { Session } from '@/core/domain/user';
import type { SessionProvider } from '@/core/ports/session-provider';
import { readSession } from '@/infrastructure/auth/session';

/**
 * Sessão real, vinda do cookie assinado.
 *
 * Substitui o `StaticSessionProvider`, que devolvia sempre o mesmo usuário e
 * tornava todo o RBAC não verificável: com um usuário só não havia como
 * observar a diferença entre uma permissão respeitada e uma ignorada.
 */
export class CookieSessionProvider implements SessionProvider {
  async getSession(): Promise<Session | null> {
    return readSession();
  }

  async getCurrentSession(): Promise<Session> {
    const session = await readSession();
    // `redirect` lança um sinal que o Next converte em resposta de desvio — por
    // isso o retorno continua sendo `Session`, sem `null`, em todas as telas.
    if (!session) redirect('/login');
    return session;
  }
}
