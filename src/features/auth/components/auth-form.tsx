'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  User,
} from 'lucide-react';
import { loginAction, signupAction, recoverPasswordAction } from '@/app/(auth)/actions';
import { cn } from '@/lib/cn';

export type AuthMode = 'login' | 'cadastro' | 'recuperar';

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

  // Estados do formulário de cadastro
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupCompany, setSignupCompany] = useState('');
  const [signupPassword, setSignupPassword] = useState('');

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
    const targetUrl = newMode === 'login' ? '/login' : newMode === 'cadastro' ? '/cadastro' : '/recuperar-senha';
    if (typeof window !== 'undefined' && window.location.pathname !== targetUrl) {
      window.history.pushState(null, '', targetUrl);
    }
  };

  // Escuta o botão voltar do navegador
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      if (path === '/cadastro') setMode('cadastro');
      else if (path === '/recuperar-senha') setMode('recuperar');
      else setMode('login');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Força da senha no cadastro
  const getStrength = (pwd: string) => {
    if (pwd.length === 0) return 0;
    if (pwd.length < 6) return 1;
    if (pwd.length < 10) return 2;
    return 3;
  };
  const strength = getStrength(signupPassword);
  const strengthLabels = ['', 'Fraca', 'Média', 'Forte'];

  // Handler de Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);

    try {
      const res = await loginAction({ email: loginEmail, password: loginPassword });
      if (res.ok) {
        const dest = next && next.startsWith('/') ? next : '/dashboard';
        window.location.href = dest;
      } else {
        setError(res.error ?? 'Email ou senha inválidos.');
        setLoading(false);
      }
    } catch {
      setError('Ocorreu um erro ao tentar entrar. Verifique sua conexão.');
      setLoading(false);
    }
  };

  // Handler de Cadastro
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);

    try {
      const res = await signupAction({
        name: signupName,
        email: signupEmail,
        company: signupCompany,
        password: signupPassword,
      });
      if (res.ok) {
        window.location.href = '/dashboard';
      } else {
        setError(res.error ?? 'Erro ao criar conta.');
        setLoading(false);
      }
    } catch {
      setError('Ocorreu um erro ao processar o cadastro.');
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

          <div className="border-t border-slate-100 pt-4 text-center text-xs text-slate-500">
            Não possui uma conta?{' '}
            <button
              type="button"
              onClick={() => switchMode('cadastro')}
              className="font-semibold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
            >
              Criar conta grátis
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODO CADASTRO                                                */}
      {/* ============================================================ */}
      {mode === 'cadastro' && (
        <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-3 duration-200">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 font-display">
              Criar sua conta
            </h2>
            <p className="mt-1.5 text-sm text-slate-500">
              Comece grátis, sem necessidade de cartão de crédito.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <AlertCircle className="size-4 shrink-0 text-red-500 mt-0.5" />
              <span className="font-medium leading-relaxed">{error}</span>
            </div>
          )}

          <form onSubmit={handleSignup} className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="signup-name" className="text-xs font-semibold text-slate-700">
                Seu nome completo
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <User className="size-4" />
                </div>
                <input
                  id="signup-name"
                  type="text"
                  required
                  value={signupName}
                  onChange={(e) => setSignupName(e.target.value)}
                  placeholder="Ex: João da Silva"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pr-3.5 pl-9 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="signup-email" className="text-xs font-semibold text-slate-700">
                E-mail de trabalho
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <Mail className="size-4" />
                </div>
                <input
                  id="signup-email"
                  type="email"
                  required
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  placeholder="voce@empresa.com"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pr-3.5 pl-9 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="signup-company" className="text-xs font-semibold text-slate-700">
                Nome da empresa
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <Building className="size-4" />
                </div>
                <input
                  id="signup-company"
                  type="text"
                  required
                  value={signupCompany}
                  onChange={(e) => setSignupCompany(e.target.value)}
                  placeholder="Ex: Minha Empresa"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pr-3.5 pl-9 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="signup-password" className="text-xs font-semibold text-slate-700">
                Senha segura
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <Lock className="size-4" />
                </div>
                <input
                  id="signup-password"
                  type="password"
                  required
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={10}
                  placeholder="Mínimo 10 caracteres"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pr-3.5 pl-9 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
                />
              </div>

              {signupPassword.length > 0 && (
                <div className="mt-1 flex items-center gap-1.5">
                  <div
                    className={cn(
                      'h-1 flex-1 rounded-full transition-colors',
                      strength >= 1 ? 'bg-amber-500' : 'bg-slate-200',
                    )}
                  />
                  <div
                    className={cn(
                      'h-1 flex-1 rounded-full transition-colors',
                      strength >= 2 ? 'bg-blue-600' : 'bg-slate-200',
                    )}
                  />
                  <div
                    className={cn(
                      'h-1 flex-1 rounded-full transition-colors',
                      strength >= 3 ? 'bg-emerald-500' : 'bg-slate-200',
                    )}
                  />
                  <span className="ml-1 text-[11px] font-semibold text-slate-500">
                    {strengthLabels[strength]}
                  </span>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 transition-all hover:from-blue-700 hover:to-indigo-800 hover:shadow-blue-600/35 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  <span>Criando conta...</span>
                </>
              ) : (
                <>
                  <span>Criar conta e continuar</span>
                  <ArrowRight className="size-4" />
                </>
              )}
            </button>
          </form>

          <div className="border-t border-slate-100 pt-4 text-center text-xs text-slate-500">
            Já possui uma conta?{' '}
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="font-semibold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
            >
              Entrar
            </button>
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
