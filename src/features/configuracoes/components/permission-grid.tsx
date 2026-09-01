'use client';

import { PERMISSION_GROUPS } from '@/core/domain/permissions';
import type { Permission } from '@/core/domain/user';
import { cn } from '@/lib/cn';

interface PermissionGridProps {
  readonly selected: readonly Permission[];
  readonly onToggle: (permission: Permission) => void;
  readonly disabled?: boolean;
  /**
   * O que o papel concede, quando a grade está personalizando uma pessoa.
   *
   * Serve para a tela distinguir "marcado porque o papel dá" de "marcado porque
   * alguém marcou aqui": sem essa distinção, o administrador não teria como
   * saber o que vai mudar sozinho quando ele editar o papel depois. Ausente na
   * edição do papel em si, onde a pergunta não existe.
   */
  readonly roleBaseline?: readonly Permission[];
}

/**
 * A grade de caixinhas — a mesma nos dois lugares que concedem permissão.
 *
 * O catálogo vem de `PERMISSION_GROUPS`, que já exclui o que nenhuma tela pode
 * oferecer (`config.equipe.papeis:*`) e o que pertence a funcionalidade
 * desligada. Isto aqui não decide nada: só desenha o que o domínio permitiu
 * oferecer, e a mesma lista é reconferida no servidor a cada gravação.
 */
export function PermissionGrid({
  selected,
  onToggle,
  disabled = false,
  roleBaseline,
}: PermissionGridProps) {
  const marcadas = new Set(selected);
  const doPapel = roleBaseline ? new Set(roleBaseline) : null;

  return (
    <div className="flex flex-col gap-5">
      {PERMISSION_GROUPS.map((grupo) => (
        <fieldset key={grupo.title} className="flex flex-col gap-2">
          <legend className="text-[11px] font-bold uppercase tracking-wider text-dim">
            {grupo.title}
          </legend>

          <div className="grid gap-1.5 sm:grid-cols-2">
            {grupo.options.map((opcao) => {
              const marcada = marcadas.has(opcao.id);
              const diferenteDoPapel = doPapel ? marcada !== doPapel.has(opcao.id) : false;

              return (
                <label
                  key={opcao.id}
                  className={cn(
                    'flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 transition-colors',
                    marcada
                      ? 'border-brand/40 bg-brand/5'
                      : 'border-line bg-surface hover:bg-surface-2',
                    disabled && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={marcada}
                    disabled={disabled}
                    onChange={() => onToggle(opcao.id)}
                    className="mt-0.5 size-3.5 shrink-0 accent-brand"
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-ink">{opcao.label}</span>
                      {diferenteDoPapel ? (
                        <span className="shrink-0 rounded-full bg-amber-soft px-1.5 py-px text-[9px] font-bold text-amber-text uppercase">
                          {marcada ? 'a mais' : 'a menos'}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted">
                      {opcao.hint}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
