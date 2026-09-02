export const AUDIT_RETENTION_DAYS = 7;

/**
 * Quinze tipos de ação, e não quarenta.
 *
 * Um registro de auditoria só serve se alguém conseguir lê-lo. A lista antiga
 * tinha 39 tipos, e a maioria descrevia trabalho comum de atendimento — mover
 * uma conversa de caixa, mudar a prioridade, trocar de workspace, sair do
 * sistema. Cada linha dessas empurra para fora da tela as que importam de
 * verdade, e o efeito prático era um filtro de ações com quarenta opções onde
 * ninguém achava a que procurava.
 *
 * O corte tem um critério: fica o que responde **quem teve acesso ao quê** e
 * **o que mudou de forma difícil de desfazer**. Sai o que é operação normal e já
 * está visível na própria conversa, que é onde se procura por ela.
 *
 * Os tipos que sobraram absorveram os vizinhos em vez de perdê-los. Criar,
 * configurar e excluir uma caixa viraram `configuracao.alterada` com
 * `metadata.detalhe` dizendo qual das três foi; papel e permissões individuais
 * viraram `acesso.alterado`. O detalhe continua no registro, o que sumiu foi a
 * necessidade de escolher entre quarenta rótulos para achá-lo.
 *
 * Três tipos cobrem conversa e mensagem, que é o que se pergunta na prática:
 * quem abriu a conversa com este cliente, quem ficou responsável por ela, e
 * quem mandou a mensagem que o cliente recebeu.
 */
export type AuditAction =
  // Acesso
  | 'sessao.login'
  | 'sessao.login_falhou'
  | 'sessao.encerrada'
  | 'senha.alterada'
  // Pessoas
  | 'membro.adicionado'
  | 'membro.removido'
  | 'acesso.alterado'
  // Atendimento
  | 'conversa.iniciada'
  | 'conversa.responsavel'
  | 'mensagem.enviada'
  | 'mensagem.apagada'
  // Dados
  | 'contatos.importados'
  | 'contatos.excluidos'
  | 'dados.exportados'
  // Estrutura
  | 'configuracao.alterada';

export type AuditTargetType =
  | 'conversa'
  | 'mensagem'
  | 'contato'
  | 'membro'
  | 'sessao'
  | 'workspace'
  | 'configuracao'
  | 'relatorio';

export const AUDIT_ACTION_LABELS: Readonly<Record<AuditAction, string>> = {
  'sessao.login': 'entrou no sistema',
  'sessao.login_falhou': 'teve o login recusado',
  'sessao.encerrada': 'encerrou sessões ativas',
  'senha.alterada': 'alterou a senha',
  'membro.adicionado': 'adicionou um membro',
  'membro.removido': 'removeu um membro',
  'acesso.alterado': 'alterou papel ou permissões',
  'conversa.iniciada': 'iniciou uma conversa',
  'conversa.responsavel': 'alterou o responsável pela conversa',
  'mensagem.enviada': 'enviou mensagem',
  'mensagem.apagada': 'apagou mensagem',
  'contatos.importados': 'importou contatos',
  'contatos.excluidos': 'excluiu contatos',
  'dados.exportados': 'exportou dados',
  'configuracao.alterada': 'alterou configurações',
};

/**
 * O que merece destaque amarelo na tela.
 *
 * Critério: dano difícil de desfazer, ou saída de dado da empresa. Não é
 * "importante" no sentido de frequente — `mensagem.enviada` é a linha mais
 * comum do registro e não está aqui, porque destacar tudo é não destacar nada.
 */
export const AUDIT_CRITICAL_ACTIONS: readonly AuditAction[] = [
  'sessao.login_falhou',
  'sessao.encerrada',
  'senha.alterada',
  'membro.removido',
  'acesso.alterado',
  'mensagem.apagada',
  'contatos.excluidos',
  'dados.exportados',
];

export type AuditGroup = 'atendimento' | 'administrativas' | 'seguranca' | 'dados';

export const auditGroupOf = (action: AuditAction): AuditGroup => {
  if (action.startsWith('conversa.') || action.startsWith('mensagem.')) return 'atendimento';
  if (action.startsWith('sessao.') || action.startsWith('senha.')) return 'seguranca';
  if (action.startsWith('contatos.') || action === 'dados.exportados') return 'dados';
  return 'administrativas';
};

export interface AuditRecord {
  readonly id: string;
  readonly actorId: string;
  readonly actorName: string;
  readonly action: AuditAction;
  readonly targetType: AuditTargetType;
  readonly targetId?: string;
  readonly targetName?: string;
  readonly ip?: string;
  readonly userAgent?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

/**
 * O rótulo de uma linha, inclusive das antigas.
 *
 * O registro guarda `action` como texto, e há sete dias de retenção: depois de
 * reduzir os tipos de 39 para 15, as linhas gravadas antes ainda trazem nomes
 * que não existem mais no tipo. Ler direto do mapa devolveria `undefined` e a
 * tela mostraria o nome de quem agiu seguido de nada. O nome cru é feio e é
 * verdadeiro, que é o que o registro precisa ser.
 */
export const auditLabelOf = (action: AuditAction | string): string =>
  AUDIT_ACTION_LABELS[action as AuditAction] ?? action;

/**
 * O complemento que o rótulo genérico não carrega.
 *
 * `configuracao.alterada` e `acesso.alterado` cobrem vários eventos, e sem isto
 * a linha diria "alterou configurações" sem dizer o quê — que é a informação
 * pela qual a pessoa abriu a tela. Quem grava põe a frase curta em
 * `metadata.detalhe`; quem não põe continua funcionando, só sem o complemento.
 */
export const auditDetailOf = (record: AuditRecord): string | undefined => {
  const detalhe = record.metadata.detalhe;
  return typeof detalhe === 'string' && detalhe.trim() ? detalhe.trim() : undefined;
};
