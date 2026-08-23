'use client';

import { useState, useTransition } from 'react';
import { Toggle } from '@/components/ui/toggle';

interface AgentActiveToggleProps {
  readonly agentId: string;
  readonly active: boolean;
  readonly setActive: (input: {
    agentId: string;
    active: boolean;
  }) => Promise<{ ok: boolean; error?: string }>;
}

export function AgentActiveToggle({ agentId, active, setActive }: AgentActiveToggleProps) {
  const [checked, setChecked] = useState(active);
  const [, startTransition] = useTransition();

  const onChange = (next: boolean) => {
    setChecked(next);
    startTransition(async () => {
      const result = await setActive({ agentId, active: next });
      if (!result.ok) setChecked(!next);
    });
  };

  return (
    <span className="flex items-center gap-2">
      <span className="text-meta text-muted">{checked ? 'Ativo' : 'Desativado'}</span>
      <Toggle checked={checked} onChange={onChange} label="Ativar agente de IA" />
    </span>
  );
}
