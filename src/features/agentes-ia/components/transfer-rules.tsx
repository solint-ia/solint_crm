'use client';

import { useState, useTransition } from 'react';
import type { TransferRule } from '@/core/domain/ai-agent';
import { TRANSFER_RULE_LABELS } from '@/core/domain/ai-agent';
import { Toggle } from '@/components/ui/toggle';

interface TransferRulesProps {
  readonly agentId: string;
  readonly rules: readonly TransferRule[];
  readonly toggleRule: (input: {
    agentId: string;
    ruleId: string;
  }) => Promise<{ ok: boolean; error?: string }>;
}

export function TransferRules({ agentId, rules, toggleRule }: TransferRulesProps) {
  const [items, setItems] = useState(rules);
  const [error, setError] = useState<string | undefined>();
  const [, startTransition] = useTransition();

  const onToggle = (ruleId: string) => {
    setItems((current) =>
      current.map((rule) => (rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule)),
    );
    startTransition(async () => {
      const result = await toggleRule({ agentId, ruleId });
      if (!result.ok) {
        setError(result.error);
        setItems((current) =>
          current.map((rule) => (rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule)),
        );
      }
    });
  };

  return (
    <>
      {error ? (
        <p role="alert" className="mb-2 rounded-control bg-red-soft px-3 py-2 text-meta text-red-text">
          {error}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {items.map((rule) => (
          <li
            key={rule.id}
            className="flex items-center justify-between gap-3 rounded-control border border-line px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="text-body font-semibold text-ink">
                {TRANSFER_RULE_LABELS[rule.type]}
              </p>
              <p className="truncate text-meta text-muted">{rule.condition}</p>
            </div>
            <Toggle
              checked={rule.enabled}
              onChange={() => onToggle(rule.id)}
              label={`Ativar regra ${TRANSFER_RULE_LABELS[rule.type]}`}
            />
          </li>
        ))}
      </ul>
    </>
  );
}
