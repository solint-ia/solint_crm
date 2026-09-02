'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
} from 'lucide-react';
import { loginAction, recoverPasswordAction } from '@/app/(auth)/actions';

/**
 * Dois modos, e não três.
 *
 * O de cadastro saiu junto com `signupAction`: no Solint cada conta é um
 * cliente com contrato, e quem a cria é o superadministrador. Um formulário de
 * "criar conta grátis" na tela de login prometia uma porta que não existe.
 */
export type AuthMode = 'login' | 'recuperar';

interface AuthFormProps {
  readonly initialMode?: AuthMode;
}

export function AuthForm({ initialMode = 'login' }: AuthFormProps) {
  const params = useSearchParams();
  const next = params.get('proximo');

  const [mode, setMode] = useState<AuthMode>(initialMode);

  // Estados do formulário de login
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // Estados do formulário de recuperação
  const [recoverEmail, setRecoverEmail] = useState('');
  const [recoverSent, setRecoverSent] = useState(false);

  // Estados de controle
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Alterna o modo e sincroniza a URL suavemente no navegador sem recarregar a página
  const switchMode = (newMode: AuthMode) => {
    setError(null);
    setMode(newMode);
    const targetUrl = newMode === 'login' ? '/login' : '/recuperar-senha';
    if (typeof window !== 'undefined' && window.location.pathname !== targetUrl) {
      window.history.pushState(null, '', targetUrl);
    }
  };

  // Escuta o botão voltar do navegador
  useEffect(() => {
    const handlePopState = () => {
      setMode(window.location.pathname === '/recuperar-senha' ? 'recuperar' : 'login');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Handler de Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);

    try {
      const res = await loginAction({ email: loginEmail, password: loginPassword });
      if (res.ok) {
        window.location.href = next?.startsWith('/') ? next : (res.destino ?? '/conversas');
      } else {
        setError(res.error ?? 'Email ou senha inválidos.');
        setLoading(false);
      }
    } catch {
      setError('Ocorreu um erro ao tentar entrar. Verifique sua conexão.');
      setLoading(false);
    }
  };

  // Handler de Recuperação de Senha
  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);

    try {
      const res = await recoverPasswordAction({ email: recoverEmail });
      if (res.ok) {
        setRecoverSent(true);
      } else {
        setError(res.error ?? 'Erro ao enviar email de recuperação.');
      }
    } catch {
      setError('Ocorreu um erro ao processar a solicitação.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 transition-all duration-200">
      {/* ============================================================ */}
      {/* MODO LOGIN                                                   */}
      {/* ============================================================ */}
      {mode === 'login' && (
        <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-3 duration-200">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 font-display">
              Acesse sua conta
            </h2>
            <p className="mt-1.5 text-sm text-slate-500">
              Entre com suas credenciais para acessar a plataforma.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <AlertCircle className="size-4 shrink-0 text-red-500 mt-0.5" />
              <span className="font-medium leading-relaxed">{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-email" className="text-xs font-semibold text-slate-700">
                E-mail de acesso
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <Mail className="size-4" />
                </div>
                <input
                  id="login-email"
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="seu.email@empresa.com"
                  autoComplete="email"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pr-3.5 pl-9 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="login-password" className="text-xs font-semibold text-slate-700">
                  Senha
                </label>
                <button
                  type="button"
                  onClick={() => switchMode('recuperar')}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
                >
                  Esqueci a senha
                </button>
              </div>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <Lock className="size-4" />
                </div>
                <input
                  id="login-password"
                  type={showLoginPassword ? 'text' : 'password'}
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pr-10 pl-9 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPassword(!showLoginPassword)}
                  aria-label={showLoginPassword ? 'Ocultar senha' : 'Exibir senha'}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                >
                  {showLoginPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center">
              <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="size-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Lembrar meus dados neste dispositivo</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 transition-all hover:from-blue-700 hover:to-indigo-800 hover:shadow-blue-600/35 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  <span>Entrando...</span>
                </>
              ) : (
                <>
                  <span>Entrar na plataforma</span>
                  <ArrowRight className="size-4" />
                </>
              )}
            </button>
          </form>

          {/* Sem "criar conta grátis": não há autoatendimento. O rodapé diz a
              quem recorrer, que é a única coisa útil para quem chegou aqui sem
              acesso. */}
          <div className="border-t border-slate-100 pt-4 text-center text-xs text-slate-500">
            Ainda não tem acesso? Fale com o administrador da sua empresa.
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODO RECUPERAR SENHA                                         */}
      {/* ============================================================ */}
      {mode === 'recuperar' && (
        <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-3 duration-200">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 font-display">
              {recoverSent ? 'Verifique seu e-mail' : 'Recuperar senha'}
            </h2>
            <p className="mt-1.5 text-sm text-slate-500">
              {recoverSent
                ? `Instruções de redefinição foram enviadas para ${recoverEmail}.`
                : 'Informe seu e-mail e enviaremos as instruções para você redefinir sua senha.'}
            </p>
          </div>

          {recoverSent ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800 leading-relaxed">
                <CheckCircle2 className="size-5 shrink-0 text-emerald-600 mt-0.5" />
                <div>
                  Verifique sua caixa de entrada e a pasta de spam. O link é válido por 1 hora.
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setRecoverSent(false);
                  switchMode('login');
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900 transition-all cursor-pointer"
              >
                <ArrowLeft className="size-4" />
                <span>Voltar para o login</span>
              </button>
            </div>
          ) : (
            <>
              {error && (
                <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  <AlertCircle className="size-4 shrink-0 text-red-500 mt-0.5" />
                  <span className="font-medium leading-relaxed">{error}</span>
                </div>
              )}

              <form onSubmit={handleRecover} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="recover-email" className="text-xs font-semibold text-slate-700">
                    E-mail cadastrado
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                      <Mail className="size-4" />
                    </div>
                    <input
                      id="recover-email"
                      type="email"
                      required
                      value={recoverEmail}
                      onChange={(e) => setRecoverEmail(e.target.value)}
                      placeholder="voce@empresa.com"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pr-3.5 pl-9 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 transition-all hover:from-blue-700 hover:to-indigo-800 hover:shadow-blue-600/35 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
                >
                  {loading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      <span>Enviando link...</span>
                    </>
                  ) : (
                    <span>Enviar link de recuperação</span>
                  )}
                </button>
              </form>

              <div className="border-t border-slate-100 pt-4 text-center text-xs text-slate-500">
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="inline-flex items-center gap-1.5 font-semibold text-slate-600 hover:text-blue-600 transition-colors cursor-pointer"
                >
                  <ArrowLeft className="size-3.5" />
                  Voltar para o login
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
