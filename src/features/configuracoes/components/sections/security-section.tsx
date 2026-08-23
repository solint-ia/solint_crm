'use client';

import { useState } from 'react';
import type { ActiveSession, AuditLogEntry } from '@/core/domain/settings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Toggle } from '@/components/ui/toggle';
import { planned } from '@/components/ui/planned';

interface SecuritySectionProps {
  readonly activeSessions: readonly ActiveSession[];
  readonly auditLog: readonly AuditLogEntry[];
}

export function SecuritySection({ activeSessions, auditLog }: SecuritySectionProps) {
  const [twoFactor, setTwoFactor] = useState(true);

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <Card className="flex items-center justify-between gap-4 p-5">
        <div>
          <h3 className="font-display text-ui font-semibold text-ink">
            Autenticação de dois fatores (2FA)
          </h3>
          <p className="mt-0.5 text-body text-muted">
            Exigir verificação em dois passos para todos os membros do workspace.
          </p>
        </div>
        <Toggle
          checked={twoFactor}
          onChange={setTwoFactor}
          label="Alternar autenticação de dois fatores"
        />
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <h3 className="font-display text-ui font-semibold text-ink">
          Sessões ativas na sua conta
        </h3>
        <div className="divide-y divide-line-soft">
          {activeSessions.map((session) => (
            <div key={session.id} className="flex items-center justify-between py-3">
              <div>
                <div className="text-ui font-semibold text-ink">{session.device}</div>
                <div className="text-meta text-muted">
                  {session.location} · Ativo: {session.lastActive}
                </div>
              </div>
              {session.current ? (
                <Badge tone="blue">Esta sessão</Badge>
              ) : (
                <Button variant="danger" size="sm" {...planned('Encerrar esta sessão remotamente')}>
                  Encerrar
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <h3 className="font-display text-ui font-semibold text-ink">
          Log de auditoria recente
        </h3>
        <div className="flex flex-col gap-2">
          {auditLog.map((log) => (
            <div
              key={log.id}
              className="flex items-start gap-3 rounded-control border border-line-soft bg-surface-2 p-3 text-body"
            >
              <span className="font-mono text-meta text-dim shrink-0">{log.at}</span>
              <div className="text-ink">
                <span className="font-semibold">{log.actor}</span> {log.action.toLowerCase()} em{' '}
                <span className="font-semibold">{log.target}</span>{' '}
                <span className="font-mono text-meta text-dim">({log.ip})</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
