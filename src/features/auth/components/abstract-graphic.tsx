'use client';

import { Layers, MessageSquare, ShieldCheck } from 'lucide-react';

/**
 * Elemento gráfico estático e abstrato que representa integração,
 * organização e tecnologia acessível para o usuário final.
 */
export function AbstractGraphic() {
  return (
    <div className="relative w-full max-w-lg select-none">
      {/* Luz ambiente suave */}
      <div className="absolute -inset-4 rounded-3xl bg-gradient-to-r from-blue-500/15 via-cyan-400/10 to-indigo-500/15 blur-2xl pointer-events-none" />

      {/* Grid de conexão entre canais, gestão e segurança */}
      <div className="relative overflow-hidden rounded-2xl border border-white/12 bg-white/[0.04] p-6 backdrop-blur-md">
        {/* Ilustração geométrica vetorial de integração */}
        <div className="relative flex items-center justify-between gap-4 py-2">
          {/* Nó 1: Canais */}
          <div className="flex flex-1 flex-col items-center gap-2 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-500/10 text-cyan-300 shadow-sm shadow-cyan-500/10">
              <MessageSquare className="size-6" />
            </div>
            <span className="text-[11px] font-semibold tracking-wide text-white">
              Canal Conectado
            </span>
            <span className="text-[10px] text-sky-200/70">WhatsApp multi-caixa</span>
          </div>

          {/* Linha conectora 1 */}
          <div className="relative h-px flex-1 bg-gradient-to-r from-cyan-400/50 via-blue-400/40 to-indigo-400/50">
            <div className="absolute left-1/2 -top-1 size-2 -translate-x-1/2 rounded-full bg-cyan-300 shadow-sm shadow-cyan-300" />
          </div>

          {/* Nó 2: Central Solint */}
          <div className="flex flex-1 flex-col items-center gap-2 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl border border-blue-400/40 bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/30">
              <Layers className="size-7" />
            </div>
            <span className="text-xs font-bold tracking-wide text-white">
              Plataforma Solint
            </span>
            <span className="text-[10px] text-sky-200/80">Gestão, Clientes e Vendas</span>
          </div>

          {/* Linha conectora 2 */}
          <div className="relative h-px flex-1 bg-gradient-to-r from-indigo-400/50 via-blue-400/40 to-cyan-400/50">
            <div className="absolute left-1/2 -top-1 size-2 -translate-x-1/2 rounded-full bg-indigo-300 shadow-sm shadow-indigo-300" />
          </div>

          {/* Nó 3: Segurança */}
          <div className="flex flex-1 flex-col items-center gap-2 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-500/10 text-emerald-300 shadow-sm shadow-emerald-500/10">
              <ShieldCheck className="size-6" />
            </div>
            <span className="text-[11px] font-semibold tracking-wide text-white">
              Segurança
            </span>
            <span className="text-[10px] text-sky-200/70">Proteção Total de Dados</span>
          </div>
        </div>

        {/* Pilares com linguagem clara e direta */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 border-t border-white/10 pt-4 text-xs">
          <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-sky-100">
            Atendimento Sem Interrupções
          </span>
          <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-sky-100">
            Ambiente Seguro da Empresa
          </span>
          <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-sky-100">
            Acesso Fácil de Qualquer Lugar
          </span>
        </div>
      </div>
    </div>
  );
}
