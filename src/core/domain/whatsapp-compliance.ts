/**
 * Intencoes de conformidade aceitas em mensagens recebidas.
 *
 * A comparacao e propositalmente exata. Procurar "sair" dentro de uma frase
 * normal ("vou sair agora") bloquearia um contato por engano; comandos curtos e
 * inequivocos oferecem protecao sem degradar o atendimento.
 */
export type WhatsAppInboundIntent = 'opt_out' | 'opt_in' | 'human_handoff';

const normalizeCommand = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const OPT_OUT = new Set([
  'PARAR',
  'STOP',
  'UNSUBSCRIBE',
  'SAIR',
  'CANCELAR',
  'CANCELAR MENSAGENS',
  'NAO QUERO RECEBER MENSAGENS',
  'PARE DE ENVIAR MENSAGENS',
  'REMOVER MEU NUMERO',
]);

const OPT_IN = new Set([
  'VOLTAR',
  'START',
  'REATIVAR',
  'QUERO RECEBER MENSAGENS',
  'PODE ENVIAR MENSAGENS',
]);

const HUMAN_HANDOFF = new Set([
  'HUMANO',
  'ATENDENTE',
  'FALAR COM ATENDENTE',
  'QUERO FALAR COM ATENDENTE',
  'SUPORTE HUMANO',
]);

export const classifyWhatsAppInboundIntent = (text: string): WhatsAppInboundIntent | undefined => {
  const command = normalizeCommand(text);
  if (OPT_OUT.has(command)) return 'opt_out';
  if (OPT_IN.has(command)) return 'opt_in';
  if (HUMAN_HANDOFF.has(command)) return 'human_handoff';
  return undefined;
};
