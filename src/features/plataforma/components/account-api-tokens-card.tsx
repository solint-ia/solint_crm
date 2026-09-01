'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  platformCreateApiTokenAction,
  platformDeleteApiTokenAction,
} from '@/app/(platform)/plataforma/actions';

export interface PlatformApiToken {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly createdLabel: string;
  readonly lastUsedLabel: string;
}

export function AccountApiTokensCard({
  accountId,
  tokens,
}: {
  readonly accountId: string;
  readonly tokens: readonly PlatformApiToken[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  /**
   * O segredo em claro só existe nesta tela, nesta vez.
   *
   * O banco guarda apenas o SHA-256 dele — se esta janela fechar sem ele ter
   * sido copiado, o caminho é revogar e gerar outro. Fica em estado, e não num
   * toast, justamente porque um aviso que some sozinho não serve para algo que
   * precisa ser copiado.
   */
  const [segredo, setSegredo] = useState<string | null>(null);

  const criar = async () => {
    setErro(null);
    const res = await platformCreateApiTokenAction({ accountId, name });
    if (!res.ok) {
      setErro(res.error ?? 'Erro ao gerar token.');
      return;
    }
    setSegredo(res.rawSecret ?? null);
    setName('');
    router.refresh();
  };

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-2xs">
      <header className="flex items-center gap-2.5 border-b border-line pb-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <KeyRound className="size-4" />
        </div>
        <div>
          <h2 className="font-display text-sm font-bold text-ink">Tokens de API</h2>
          <p className="text-xs text-muted">
            Autenticam chamadas à API pública desta conta. O segredo aparece uma única vez.
          </p>
        </div>
      </header>

      {tokens.length === 0 ? (
        <p className="mt-4 text-xs text-muted">Nenhum token nesta conta.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {tokens.map((token) => (
            <li
              key={token.id}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 p-3"
            >
              <div className="min-w-0 flex-1">
                <span className="truncate text-xs font-semibold text-ink">{token.name}</span>
                <p className="font-mono text-[11px] text-dim">{token.prefix}••••</p>
                <p className="text-[11px] text-muted">
                  Criado em {token.createdLabel} · Último uso: {token.lastUsedLabel}
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                aria-label={`Revogar token ${token.name}`}
                onClick={() =>
                  startTransition(async () => {
                    await platformDeleteApiTokenAction({ accountId, tokenId: token.id });
                    router.refresh();
                  })
                }
                className="shrink-0 rounded-lg p-1.5 text-dim transition-colors hover:bg-red-soft hover:text-red-text"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {segredo ? (
        <div className="mt-4 rounded-xl border border-amber-line/50 bg-amber-soft/40 p-3">
          <p className="text-[11px] font-semibold text-amber-text">
            Copie agora — este segredo não será mostrado de novo.
          </p>
          <code className="mt-1 block break-all font-mono text-xs text-ink">{segredo}</code>
          <button
            type="button"
            onClick={() => setSegredo(null)}
            className="mt-2 text-[11px] font-medium text-muted underline transition-colors hover:text-ink"
          >
            Já copiei, ocultar
          </button>
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4 sm:flex-row">
        <input
          type="text"
          placeholder="Nome do token (ex.: Integração ERP)"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-9 flex-1 rounded-xl border border-line bg-surface px-3 text-xs text-ink placeholder:text-dim outline-none focus:border-brand"
        />
        <Button
          type="button"
          size="sm"
          icon={<Plus className="size-3.5" />}
          disabled={pending || name.trim().length < 2}
          onClick={() => startTransition(criar)}
        >
          Gerar token
        </Button>
      </div>

      {erro ? <p className="mt-1.5 text-[11px] text-red-text">{erro}</p> : null}
    </section>
  );
}
