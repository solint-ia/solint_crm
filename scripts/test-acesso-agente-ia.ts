/**
 * Regressao sem banco para a capacidade de IA por conta.
 *
 * O bloqueio de persistencia e coberto pelos testes integrados de pausa e
 * webhook. Aqui fica a regra pura que alimenta rail, busca e paginas.
 */
import { hasAiAgentAccess } from '../src/config/ai-agent-access';
import { navItemsForSession } from '../src/config/navigation';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type Account,
  type Session,
} from '../src/core/domain/user';

const failures: string[] = [];
const check = (label: string, condition: boolean) => {
  console.log(`${condition ? 'OK   ' : 'FALHA'} ${label}`);
  if (!condition) failures.push(label);
};

const account = (enabled: boolean): Account => ({
  id: enabled ? 'acc-ai-on' : 'acc-ai-off',
  name: enabled ? 'Conta com IA' : 'Conta sem IA',
  plan: 'profissional',
  aiAgentAccessEnabled: enabled,
});

const session = (enabled: boolean, permission = true): Session => {
  const current = account(enabled);
  return {
    tokenId: 'teste-acesso-ia',
    user: {
      id: 'user-teste-ia',
      accountId: current.id,
      name: 'Pessoa de teste',
      email: 'teste-ia@localhost',
      roleSlug: 'administrador',
      avatarTone: 'slate',
      availability: 'disponivel',
      teams: [],
      signatureEnabled: false,
      notifications: DEFAULT_NOTIFICATION_PREFERENCES,
      twoFactorEnabled: false,
    },
    account: current,
    availableAccounts: [current],
    permissions: permission ? ['agentes-ia:ler'] : [],
    inboxAccess: 'todas',
  };
};

check('conta desligada nao possui capacidade', !hasAiAgentAccess(account(false)));
check('conta ligada possui capacidade', hasAiAgentAccess(account(true)));
check(
  'navegacao esconde agentes de conta desligada',
  !navItemsForSession(session(false)).some((item) => item.id === 'agentes-ia'),
);
check(
  'navegacao mostra agentes para conta e usuario autorizados',
  navItemsForSession(session(true)).some((item) => item.id === 'agentes-ia'),
);
check(
  'habilitacao da conta nao substitui permissao',
  !navItemsForSession(session(true, false)).some((item) => item.id === 'agentes-ia'),
);

if (failures.length > 0) {
  throw new Error(`${failures.length} falha(s): ${failures.join(', ')}`);
}

console.log('\nTodos os testes de acesso ao agente de IA passaram.');
