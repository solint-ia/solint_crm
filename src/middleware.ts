import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/infrastructure/auth/tokens';

/**
 * Portão de entrada do workspace.
 *
 * Roda no Edge, onde não há banco: aqui só se confere a **assinatura** do
 * token. A checagem de revogação — a que derruba um acesso roubado — acontece
 * no servidor, em `readSession`. Esta divisão é intencional e está descrita em
 * `infrastructure/auth/tokens.ts`.
 *
 * O papel deste arquivo é evitar que uma tela protegida chegue a ser renderizada
 * para quem não tem cookie nenhum, e mandar quem já entrou para longe da tela
 * de login.
 */

const PROTECTED = [
  '/dashboard',
  '/conversas',
  '/contatos',
  '/kanban',
  '/agentes-ia',
  '/campanhas',
  '/relatorios',
  '/configuracoes',
  '/perfil',
];

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const claims = token ? await verifySessionToken(token) : null;

  if (PROTECTED.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    if (!claims) {
      const login = new URL('/login', request.url);
      // Guardar o destino faz o login devolver a pessoa para onde ela ia, em
      // vez de despejá-la sempre no painel.
      if (pathname !== '/dashboard') login.searchParams.set('proximo', `${pathname}${search}`);
      return NextResponse.redirect(login);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Fora do matcher: estáticos, imagens e as rotas de API.
   *
   * As de API ficam de fora porque um redirecionamento HTML não serve a um
   * cliente que espera JSON — cada uma responde 401 por conta própria.
   */
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
