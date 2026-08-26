'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Clock,
  Laptop,
  Lock,
  LogOut,
  Shield,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import type { ActiveSession, AuditLogEntry } from '@/core/domain/settings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { useToast } from '@/components/ui/toast';
import {
  terminateOtherSessionsAction,
  terminateSessionAction,
} from '@/app/(workspace)/configuracoes/actions';

interface SecuritySectionProps {
  readonly activeSessions: readonly ActiveSession[];
  readonly auditLog: readonly AuditLogEntry[];
}

export function SecuritySection({
  activeSessions: initialSessions,
  auditLog,
}: SecuritySectionProps) {
  const { show } = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [sessions, setSessions] = useState<readonly ActiveSession[]>(initialSessions);

  // A lista é do servidor: depois do `router.refresh()` a versão nova entra.
  useEffect(() => {
    setSessions(initialSessions);
  }, [initialSessions]);

  const [twoFactorRequired, setTwoFactorRequired] = useState(true);
  const [sessionTimeout, setSessionTimeout] = useState('24h');
  const [enforcePasswordChange, setEnforcePasswordChange] = useState(false);

  const [terminatingSession, setTerminatingSession] = useState<ActiveSession | null>(null);
  const [terminateAllOpen, setTerminateAllOpen] = useState(false);

  const handleConfirmTerminateSession = () => {
    if (!terminatingSession) return;
    const alvo = terminatingSession;

    startTransition(async () => {
      const result = await terminateSessionAction({ sessionId: alvo.id });
      setTerminatingSession(null);

      if (!result.ok) {
        show({
          tone: 'erro',
          title: 'Falha ao encerrar',
          description: result.error ?? 'Não foi possível encerrar a sessão.',
        });
        return;
      }

      setSessions((prev) => prev.filter((s) => s.id !== alvo.id));
      show({
        tone: 'sucesso',
        title: 'Sessão encerrada',
        description: `A sessão em ${alvo.device} foi desconectada.`,
      });
      router.refresh();
    });
  };

  const handleConfirmTerminateAll = () => {
    startTransition(async () => {
      const result = await terminateOtherSessionsAction();
      setTerminateAllOpen(false);

      if (!result.ok) {
        show({
          tone: 'erro',
          title: 'Falha ao encerrar',
          description: result.error ?? 'Não foi possível encerrar as sessões.',
        });
        return;
      }

      setSessions((prev) => prev.filter((s) => s.current));
      show({
        tone: 'sucesso',
        title: 'Sessões encerradas',
        description: 'Todas as outras sessões ativas foram desconectadas com sucesso.',
      });
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6 max-w-4xl pb-16 animate-in fade-in duration-200">
      {/* ============================================================ */}
      {/* CABEÇALHO                                                    */}
      {/* ============================================================ */}
      <div className="flex flex-col gap-1 border-b border-line pb-5">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-xl font-bold tracking-tight text-ink">
            Segurança e privacidade
          </h2>
        </div>
        <p className="text-sm text-muted">
          Gerencie a autenticação em dois fatores, controle as sessões ativas e monitore o histórico de auditoria.
        </p>
      </div>

      {/* ============================================================ */}
      {/* 1. AUTENTICAÇÃO DE DOIS FATORES (2FA)                         */}
      {/* ============================================================ */}
      <section className="rounded-2xl border border-line bg-surface p-6 shadow-2xs">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display text-base font-bold text-ink">
                  Autenticação em dois fatores (2FA)
                </h3>
                <Badge tone="green" withDot>
                  Ativado na sua conta
                </Badge>
              </div>
              <p className="text-xs text-muted">
                Método principal: Aplicativo autenticador (TOTP como Google Authenticator ou 1Password).
              </p>
            </div>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              show({
                tone: 'info',
                title: 'Configurações 2FA',
                description: 'Seu aplicativo autenticador já está vinculado com sucesso.',
              })
            }
          >
            Reconfigurar 2FA
          </Button>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-ink">
              Exigir 2FA para todos os membros do workspace
            </span>
            <p className="text-[11px] text-muted">
              Novos operadores e administradores serão obrigados a configurar um autenticador no primeiro login.
            </p>
          </div>
          <Toggle
            checked={twoFactorRequired}
            onChange={(checked) => {
              setTwoFactorRequired(checked);
              show({
                tone: 'sucesso',
                title: 'Política atualizada',
                description: checked
                  ? '2FA agora é obrigatório para todos os membros.'
                  : '2FA tornou-se opcional para a equipe.',
              });
            }}
            label="Exigir 2FA no workspace"
          />
        </div>
      </section>

      {/* ============================================================ */}
      {/* 2. SESSÕES ATIVAS                                            */}
      {/* ============================================================ */}
      <section className="rounded-2xl border border-line bg-surface p-6 shadow-2xs">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Laptop className="size-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-ink">
                Sessões ativas na sua conta
              </h3>
              <p className="text-xs text-muted">
                Navegadores e dispositivos autorizados atualmente no CRM.
              </p>
            </div>
          </div>

          {sessions.filter((s) => !s.current).length > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              className="text-red-600 dark:text-red-400 border-red-500/30 hover:bg-red-500/10"
              icon={<LogOut className="size-3.5" />}
              onClick={() => setTerminateAllOpen(true)}
            >
              Encerrar todas as outras sessões
            </Button>
          ) : null}
        </div>

        <div className="mt-2 divide-y divide-line-soft">
          {sessions.map((session) => {
            const isMobile = session.device.toLowerCase().includes('phone') || session.device.toLowerCase().includes('android');
            return (
              <div
                key={session.id}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3.5">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-dim">
                    {isMobile ? <Smartphone className="size-4" /> : <Laptop className="size-4" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-ink">
                        {session.device}
                      </span>
                      {session.current ? (
                        <Badge tone="blue">Esta sessão</Badge>
                      ) : null}
                    </div>
                    <span className="mt-0.5 text-meta text-muted block">
                      {session.location} · Última atividade: {session.lastActive}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-center">
                  {!session.current ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 dark:text-red-400 hover:bg-red-500/10"
                      onClick={() => setTerminatingSession(session)}
                    >
                      Encerrar sessão
                    </Button>
                  ) : (
                    <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <span className="size-1.5 rounded-full bg-emerald-500" />
                      Dispositivo atual
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ============================================================ */}
      {/* 3. POLÍTICAS DE ACESSO E EXPIRAÇÃO                           */}
      {/* ============================================================ */}
      <section className="rounded-2xl border border-line bg-surface p-6 shadow-2xs">
        <div className="flex items-center gap-3 border-b border-line pb-4">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Lock className="size-5" />
          </div>
          <div>
            <h3 className="font-display text-base font-bold text-ink">
              Políticas de acesso e expiração
            </h3>
            <p className="text-xs text-muted">
              Configure regras de timeout para inatividade e conformidade de senhas.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="sec-timeout" className="mb-1 block text-xs font-semibold text-ink">
              Expiração automática por inatividade
            </label>
            <select
              id="sec-timeout"
              value={sessionTimeout}
              onChange={(e) => setSessionTimeout(e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand shadow-2xs"
            >
              <option value="1h">1 hora de inatividade</option>
              <option value="8h">8 horas (Fim do expediente)</option>
              <option value="24h">24 horas (Recomendado)</option>
              <option value="7d">7 dias</option>
            </select>
          </div>

          <div>
            <label htmlFor="sec-pwd" className="mb-1 block text-xs font-semibold text-ink">
              Renovação periódica de senhas
            </label>
            <select
              id="sec-pwd"
              value={enforcePasswordChange ? '90' : 'nunca'}
              onChange={(e) => setEnforcePasswordChange(e.target.value === '90')}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand shadow-2xs"
            >
              <option value="nunca">Não forçar troca periódica</option>
              <option value="90">A cada 90 dias (Recomendação ISO)</option>
            </select>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/* 4. LOG DE AUDITORIA RECENTE                                  */}
      {/* ============================================================ */}
      <section className="rounded-2xl border border-line bg-surface p-6 shadow-2xs">
        <div className="flex items-center gap-3 border-b border-line pb-4">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
            <Clock className="size-5" />
          </div>
          <div>
            <h3 className="font-display text-base font-bold text-ink">
              Log de auditoria recente
            </h3>
            <p className="text-xs text-muted">
              Registro cronológico imutável de ações administrativas sensíveis no workspace.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2.5">
          {auditLog.map((log) => (
            <div
              key={log.id}
              className="flex items-start gap-3.5 rounded-xl border border-line-soft bg-surface-2/60 p-3.5 text-xs transition-colors hover:bg-surface-2"
            >
              <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface border border-line text-dim">
                <Shield className="size-3.5" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-ink leading-relaxed">
                  <strong className="font-bold text-ink">{log.actor}</strong>{' '}
                  <span className="text-muted">{log.action.toLowerCase()} em</span>{' '}
                  <strong className="font-semibold text-ink">{log.target}</strong>
                </div>
                <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-dim">
                  <span>{log.at}</span>
                  <span>·</span>
                  <span>IP: {log.ip}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Confirmação de Encerramento de Sessão Individual */}
      <ConfirmModal
        open={terminatingSession !== null}
        title="Encerrar sessão"
        description={
          <span>
            Deseja desconectar o dispositivo{' '}
            <strong className="text-ink">{terminatingSession?.device}</strong>? O usuário precisará realizar login novamente com usuário e senha.
          </span>
        }
        confirmLabel="Encerrar sessão"
        variant="danger"
        isLoading={isPending}
        onClose={() => setTerminatingSession(null)}
        onConfirm={handleConfirmTerminateSession}
      />

      {/* Confirmação de Encerramento Global */}
      <ConfirmModal
        open={terminateAllOpen}
        title="Encerrar todas as outras sessões"
        description="Todas as sessões abertas em outros computadores e smartphones serão desconectadas imediatamente, mantendo apenas este dispositivo ativo."
        confirmLabel="Desconectar todas as outras"
        variant="danger"
        isLoading={isPending}
        onClose={() => setTerminateAllOpen(false)}
        onConfirm={handleConfirmTerminateAll}
      />
    </div>
  );
}
