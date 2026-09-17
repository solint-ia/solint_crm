'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Inbox, Layers, Loader2 } from 'lucide-react';
import { LIMIT_MAX, parseLimitInput } from '@/core/domain/account-limits';
import { setAccountLimitsAction } from '@/app/(platform)/plataforma/account-actions';
import { Button } from '@/components/ui/button';

/**
 * Os tetos comerciais da conta, na mão de quem responde pela plataforma.
 *
 * Campo vazio é "sem limite", e o texto diz isso: um zero implícito seria a
 * leitura errada e a mais cara, porque travaria a conta inteira sem ninguém
 * ter pedido. Zero digitado à mão continua valendo, e é como se impede uma
 * conta de criar qualquer caixa.
 *
 * O uso atual aparece ao lado de cada campo. Sem ele, definir um teto seria
 * chutar: quem digita "3" precisa saber que a conta já tem 5.
 */
export function AccountLimitsCard({
  accountId,
  initialMaxInboxes,
  initialMaxWorkspaces,
  usedInboxes,
  usedWorkspaces,
}: {
  readonly accountId: string;
  readonly initialMaxInboxes: number | null;
  readonly initialMaxWorkspaces: number | null;
  readonly usedInboxes: number;
  readonly usedWorkspaces: number;
}) {
  const router = useRouter();
  const [inboxes, setInboxes] = useState(
    initialMaxInboxes === null ? '' : String(initialMaxInboxes),
  );
  const [workspaces, setWorkspaces] = useState(
    initialMaxWorkspaces === null ? '' : String(initialMaxWorkspaces),
  );
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string }>();

  const salvar = () => {
    const caixas = parseLimitInput(inboxes);
    if (!caixas.ok) {
      setMessage({ tone: 'error', text: `Caixas de entrada: ${caixas.error}` });
      return;
    }
    const espacos = parseLimitInput(workspaces);
    if (!espacos.ok) {
      setMessage({ tone: 'error', text: `Workspaces: ${espacos.error}` });
      return;
    }

    setMessage(undefined);
    startTransition(async () => {
      const result = await setAccountLimitsAction({
        accountId,
        maxInboxes: caixas.value,
        maxWorkspaces: espacos.value,
      });
      if (!result.ok) {
        setMessage({ tone: 'error', text: result.error ?? 'Não foi possível salvar os limites.' });
        return;
      }
      setMessage({ tone: 'success', text: 'Limites salvos.' });
      router.refresh();
    });
  };

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-2xs">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300">
          <Layers className="size-4.5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-sm font-bold text-ink">Limites da conta</h2>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">
            Deixe vazio para não impor teto. Baixar um limite não apaga o que já existe: ele impede
            a próxima criação. O teto vale para todos, inclusive para você atuando dentro da conta.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <CampoDeLimite
          id="limite-caixas"
          icone={<Inbox className="size-3.5" />}
          label="Caixas de entrada"
          value={inboxes}
          onChange={setInboxes}
          used={usedInboxes}
          usedLabel={usedInboxes === 1 ? 'caixa criada' : 'caixas criadas'}
          disabled={pending}
        />
        <CampoDeLimite
          id="limite-workspaces"
          icone={<Layers className="size-3.5" />}
          label="Workspaces criados a partir desta conta"
          value={workspaces}
          onChange={setWorkspaces}
          used={usedWorkspaces}
          usedLabel={usedWorkspaces === 1 ? 'workspace criado' : 'workspaces criados'}
          disabled={pending}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={pending}
          icon={pending ? <Loader2 className="size-3.5 animate-spin" /> : undefined}
          onClick={salvar}
        >
          Salvar limites
        </Button>
        {message ? (
          <p
            role={message.tone === 'error' ? 'alert' : 'status'}
            className={`text-xs font-medium ${
              message.tone === 'error' ? 'text-rose-600' : 'text-emerald-700 dark:text-emerald-300'
            }`}
          >
            {message.text}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function CampoDeLimite({
  id,
  icone,
  label,
  value,
  onChange,
  used,
  usedLabel,
  disabled,
}: {
  readonly id: string;
  readonly icone: React.ReactNode;
  readonly label: string;
  readonly value: string;
  readonly onChange: (valor: string) => void;
  readonly used: number;
  readonly usedLabel: string;
  readonly disabled: boolean;
}) {
  const limite = value.trim() === '' ? null : Number(value);
  const estourou = limite !== null && Number.isFinite(limite) && used > limite;

  return (
    <div className="rounded-xl border border-line bg-surface-2/40 p-3">
      <label
        htmlFor={id}
        className="flex items-center gap-1.5 text-[11px] font-semibold text-muted"
      >
        {icone}
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={0}
        max={LIMIT_MAX}
        inputMode="numeric"
        value={value}
        disabled={disabled}
        placeholder="Sem limite"
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none transition-colors focus:border-brand disabled:opacity-60"
      />
      <p className="mt-1.5 text-[11px] text-dim">
        {used.toLocaleString('pt-BR')} {usedLabel}
        {estourou ? (
          <span className="ml-1 font-semibold text-amber-600 dark:text-amber-400">
            · acima do teto, nada novo será criado
          </span>
        ) : null}
      </p>
    </div>
  );
}
