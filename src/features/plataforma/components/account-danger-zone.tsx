'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, PlayCircle } from 'lucide-react';
import {
  deleteAccountAction,
  reactivateAccountAction,
  suspendAccountAction,
} from '@/app/(platform)/plataforma/account-actions';

interface AccountDangerZoneProps {
  readonly accountId: string;
  readonly accountName: string;
  readonly status: string;
  readonly suspendedAt?: string;
}

type Gesto = 'suspender' | 'excluir';

const campo =
  'h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink placeholder:text-dim outline-none transition-all focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20';

/**
 * Suspender, reativar e excluir — as três ações que tiram a conta do ar.
 *
 * Nenhuma delas apaga dado: suspender e excluir marcam o estado, e o efeito
 * para quem estava dentro vem de `readSession()`, que recusa conta fora de
 * `ativa`. Isso é dito na tela, e não só no código: um botão chamado "excluir"
 * que na verdade arquiva precisa avisar, ou quem clica acha que destruiu
 * conversas que continuam lá — e quem não clica deixa de usar a ação achando
 * que ela é irreversível.
 *
 * As duas ações destrutivas exigem o nome da conta digitado por extenso.
 * Reativar não exige: pedir o mesmo ritual para uma ação que não destrói nada
 * ensinaria a digitar o nome no automático, e a trava perderia o valor
 * justamente onde ela precisa funcionar.
 */
export function AccountDangerZone({
  accountId,
  accountName,
  status,
  suspendedAt,
}: AccountDangerZoneProps) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [gesto, setGesto] = useState<Gesto>();
  const [confirmName, setConfirmName] = useState('');
  const [reason, setReason] = useState('');
  const [erro, setErro] = useState<string>();

  const fechar = () => {
    setGesto(undefined);
    setConfirmName('');
    setReason('');
    setErro(undefined);
  };

  const executar = (qual: Gesto) => {
    setErro(undefined);
    startTransition(async () => {
      const acao = qual === 'suspender' ? suspendAccountAction : deleteAccountAction;
      const resultado = await acao({ accountId, confirmName, reason });
      if (!resultado.ok) {
        setErro(resultado.error ?? 'Não foi possível concluir.');
        return;
      }
      fechar();
      router.refresh();
    });
  };

  const reativar = () => {
    setErro(undefined);
    startTransition(async () => {
      const resultado = await reactivateAccountAction({ accountId });
      if (!resultado.ok) {
        setErro(resultado.error ?? 'Não foi possível reativar.');
        return;
      }
      router.refresh();
    });
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-2xs">
        <h2 className="font-display text-sm font-bold text-ink">O que estas ações fazem</h2>
        <ul className="mt-2 flex flex-col gap-1.5 text-[11px] leading-relaxed text-muted">
          <li>
            <strong className="text-ink">Suspender</strong> tira a conta do ar. Ninguém entra, as
            sessões abertas caem, e o WhatsApp para de ser atendido. Reversível a qualquer momento.
          </li>
          <li>
            <strong className="text-ink">Excluir</strong> tem o mesmo efeito para o cliente, e
            marca a conta como excluída no console. As conversas, as mensagens e o histórico de
            auditoria continuam guardados: nada é apagado do banco.
          </li>
          <li>
            Para uma remoção definitiva dos dados, exigida por contrato ou por lei, fale com quem
            cuida do banco: não é uma operação de tela.
          </li>
        </ul>
      </div>

      {status !== 'ativa' ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-5">
          <div>
            <h3 className="font-display text-sm font-bold text-ink">
              Conta {status === 'excluida' ? 'excluída' : 'suspensa'}
              {suspendedAt
                ? ` em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(suspendedAt))}`
                : ''}
            </h3>
            <p className="text-[11px] text-muted">
              Reativar devolve o acesso de todo mundo, com os dados como estavam.
            </p>
          </div>
          <button
            type="button"
            disabled={pendente}
            onClick={reativar}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
          >
            {pendente ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <PlayCircle className="size-3.5" />
            )}
            Reativar conta
          </button>
        </div>
      ) : null}

      <div className="flex flex-col gap-4 rounded-2xl border border-rose-500/40 bg-rose-500/5 p-5">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-600" />
          <div>
            <h3 className="font-display text-sm font-bold text-ink">Zona de perigo</h3>
            <p className="text-[11px] text-muted">
              Confirme digitando <strong className="text-ink">{accountName}</strong>.
            </p>
          </div>
        </div>

        {gesto ? (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-muted">Nome da conta</span>
              <input
                value={confirmName}
                onChange={(event) => setConfirmName(event.target.value)}
                placeholder={accountName}
                autoComplete="off"
                className={campo}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-muted">
                Motivo (aparece para quem tentar entrar)
              </span>
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={300}
                placeholder="Ex.: contrato encerrado em 30/09"
                className={campo}
              />
            </label>

            {erro ? <p className="text-xs font-medium text-rose-600">{erro}</p> : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pendente || confirmName.trim().length === 0}
                onClick={() => executar(gesto)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
              >
                {pendente ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {gesto === 'suspender' ? 'Suspender a conta' : 'Excluir a conta'}
              </button>
              <button
                type="button"
                onClick={fechar}
                className="rounded-xl border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-muted transition-colors hover:text-ink"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {status === 'ativa' ? (
              <button
                type="button"
                onClick={() => setGesto('suspender')}
                className="rounded-xl border border-amber-500/40 bg-surface px-3.5 py-2 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-500/10"
              >
                Suspender conta
              </button>
            ) : null}
            {status !== 'excluida' ? (
              <button
                type="button"
                onClick={() => setGesto('excluir')}
                className="rounded-xl border border-rose-500/40 bg-surface px-3.5 py-2 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-500/10"
              >
                Excluir conta
              </button>
            ) : null}
            {erro ? <p className="w-full text-xs font-medium text-rose-600">{erro}</p> : null}
          </div>
        )}
      </div>
    </section>
  );
}
