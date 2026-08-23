/**
 * Casca das rotas de entrada.
 *
 * Deliberadamente sem cor de fundo: quem pinta é a `AuthSplitLayout`, e um
 * `bg-app` claro aqui apareceria por baixo do gradiente durante o carregamento
 * das fontes. `w-full` em vez de `w-screen` porque `100vw` inclui a barra de
 * rolagem e criaria um deslocamento horizontal de alguns pixels.
 */
export default function AuthLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return <div className="min-h-screen w-full">{children}</div>;
}
