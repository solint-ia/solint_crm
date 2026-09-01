export const AUDIT_RETENTION_DAYS = 7;

export type AuditAction =
  | 'conversa.assumida' | 'conversa.atribuida' | 'conversa.liberada'
  | 'conversa.status' | 'conversa.movida' | 'conversa.prioridade'
  | 'mensagem.enviada' | 'mensagem.apagada'
  | 'membro.convidado' | 'membro.removido' | 'membro.papel' | 'membro.permissoes'
  | 'papel.criado' | 'papel.editado' | 'papel.excluido'
  | 'caixa.criada' | 'caixa.configurada' | 'caixa.excluida'
  | 'whatsapp.conectado' | 'whatsapp.desconectado'
  | 'empresa.alterada' | 'funil.etapas'
  | 'automacao.criada' | 'automacao.editada' | 'automacao.excluida'
  | 'workspace.criado' | 'workspace.trocado'
  | 'sessao.login' | 'sessao.login_falhou' | 'sessao.logout'
  | 'sessao.encerrada' | 'sessao.encerrada_todas' | 'senha.alterada'
  | 'contatos.exportados' | 'contatos.importados' | 'contatos.excluidos'
  | 'relatorio.exportado' | 'campanha.disparada';

export type AuditTargetType =
  | 'conversa' | 'mensagem' | 'contato' | 'membro' | 'papel' | 'caixa'
  | 'funil' | 'automacao' | 'sessao' | 'workspace' | 'empresa'
  | 'campanha' | 'relatorio';

export const AUDIT_ACTION_LABELS: Readonly<Record<AuditAction, string>> = {
  'conversa.assumida': 'assumiu a conversa',
  'conversa.atribuida': 'atribuiu a conversa',
  'conversa.liberada': 'devolveu a conversa para a fila',
  'conversa.status': 'alterou o status da conversa',
  'conversa.movida': 'moveu a conversa entre caixas',
  'conversa.prioridade': 'alterou a prioridade da conversa',
  'mensagem.enviada': 'enviou mensagem',
  'mensagem.apagada': 'apagou mensagem',
  'membro.convidado': 'adicionou um membro',
  'membro.removido': 'removeu um membro',
  'membro.papel': 'alterou o papel de um membro',
  'membro.permissoes': 'alterou permissões individuais',
  'papel.criado': 'criou um papel',
  'papel.editado': 'editou um papel',
  'papel.excluido': 'excluiu um papel',
  'caixa.criada': 'criou uma caixa de entrada',
  'caixa.configurada': 'configurou uma caixa de entrada',
  'caixa.excluida': 'excluiu uma caixa de entrada',
  'whatsapp.conectado': 'conectou o WhatsApp',
  'whatsapp.desconectado': 'desconectou o WhatsApp',
  'empresa.alterada': 'alterou os dados da empresa',
  'funil.etapas': 'alterou as etapas do funil',
  'automacao.criada': 'criou uma automação',
  'automacao.editada': 'editou uma automação',
  'automacao.excluida': 'excluiu uma automação',
  'workspace.criado': 'criou um workspace',
  'workspace.trocado': 'trocou de workspace',
  'sessao.login': 'entrou no sistema',
  'sessao.login_falhou': 'teve um login recusado',
  'sessao.logout': 'saiu do sistema',
  'sessao.encerrada': 'encerrou uma sessão',
  'sessao.encerrada_todas': 'encerrou todas as sessões',
  'senha.alterada': 'alterou a senha',
  'contatos.exportados': 'exportou contatos',
  'contatos.importados': 'importou contatos',
  'contatos.excluidos': 'excluiu contatos',
  'relatorio.exportado': 'exportou um relatório',
  'campanha.disparada': 'disparou uma campanha',
};

export const AUDIT_CRITICAL_ACTIONS: readonly AuditAction[] = [
  'caixa.excluida', 'papel.excluido', 'membro.permissoes',
  'contatos.exportados', 'whatsapp.desconectado',
  'contatos.excluidos', 'sessao.encerrada_todas',
];

export type AuditGroup = 'atendimento' | 'administrativas' | 'seguranca' | 'dados';

export const auditGroupOf = (action: AuditAction): AuditGroup => {
  if (action.startsWith('conversa.') || action.startsWith('mensagem.')) return 'atendimento';
  if (action.startsWith('sessao.') || action.startsWith('senha.')) return 'seguranca';
  if (action.startsWith('contatos.') || action === 'relatorio.exportado') return 'dados';
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
