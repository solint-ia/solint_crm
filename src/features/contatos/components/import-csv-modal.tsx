'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ProgressBar } from '@/components/ui/progress-bar';

const COLUMNS = [
  { csv: 'nome_completo', field: 'Nome' },
  { csv: 'telefone', field: 'Telefone (E.164)' },
  { csv: 'email', field: 'E-mail' },
  { csv: 'empresa', field: 'Empresa' },
] as const;

/** Importacao CSV: mapeamento de colunas, progresso e relatorio de erros. */
export function ImportCsvModal({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const [step, setStep] = useState<'mapeamento' | 'progresso'>('mapeamento');

  const close = () => {
    setStep('mapeamento');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Importar contatos por CSV"
      description="Relacione as colunas do arquivo aos campos do CRM antes de importar."
      footer={
        step === 'mapeamento' ? (
          <>
            <Button variant="secondary" size="sm" onClick={close}>
              Cancelar
            </Button>
            <Button size="sm" onClick={() => setStep('progresso')}>
              Iniciar importação
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={close}>
            Concluir
          </Button>
        )
      }
    >
      {step === 'mapeamento' ? (
        <ul className="flex flex-col gap-2">
          {COLUMNS.map((column) => (
            <li
              key={column.csv}
              className="flex items-center justify-between gap-3 rounded-control border border-line px-3 py-2"
            >
              <span className="font-mono text-meta text-muted">{column.csv}</span>
              <span className="text-dim">para</span>
              <span className="text-body font-semibold text-ink">{column.field}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <div className="mb-1.5 flex items-center justify-between text-meta">
              <span className="text-ink">Importando 1.280 de 2.000 contatos</span>
              <span className="text-muted">64%</span>
            </div>
            <ProgressBar value={64} label="Progresso da importação" />
          </div>
          <div className="rounded-control border border-red-line bg-red-soft px-3 py-2.5">
            <p className="text-body font-semibold text-red-text">12 linhas com erro</p>
            <ul className="mt-1 list-disc pl-4 text-meta text-red-text">
              <li>8 telefones fora do padrão E.164</li>
              <li>3 e-mails inválidos</li>
              <li>1 linha duplicada</li>
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}
