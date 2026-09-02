/**
 * Variáveis dinâmicas de mensagem: `{{cliente.nome}}` e companhia.
 *
 * As quatro tags existiam desde sempre **como texto na tela** de respostas
 * rápidas, listadas ao lado do editor como se funcionassem. Não funcionavam:
 * não havia interpolador em lugar nenhum do projeto, nem no cliente nem no
 * servidor, e o cliente recebia literalmente
 * `Olá {{cliente.nome}}, aqui é {{agente.nome}}`.
 *
 * Puro e sem I/O de propósito: a mesma função é usada pelo composer (para o
 * atendente **ver** o texto final antes de enviar) e pela Server Action (que
 * revalida tudo antes de despachar). Duas implementações divergiriam, e a
 * divergência apareceria na conversa do cliente.
 */

export interface VariableContext {
  readonly clienteNome?: string;
  readonly agenteNome?: string;
  readonly empresa?: string;
  readonly protocolo?: string;
}

export interface MessageVariable {
  readonly tag: string;
  readonly label: string;
  readonly campo: keyof VariableContext;
  /** O que a tela de ajuda explica sobre esta variável. */
  readonly hint: string;
}

export const MESSAGE_VARIABLES: readonly MessageVariable[] = [
  {
    tag: '{{cliente.nome}}',
    label: 'Nome do cliente',
    campo: 'clienteNome',
    hint: 'O nome do contato da conversa, como está no cadastro.',
  },
  {
    tag: '{{agente.nome}}',
    label: 'Nome do atendente',
    campo: 'agenteNome',
    hint: 'Quem está enviando a mensagem neste momento.',
  },
  {
    tag: '{{empresa}}',
    label: 'Nome da empresa',
    campo: 'empresa',
    hint: 'O nome fantasia da conta, ou o nome do workspace se ele não estiver preenchido.',
  },
  {
    tag: '{{protocolo}}',
    label: 'Número de protocolo',
    campo: 'protocolo',
    hint: 'O código do atendimento em aberto, aquele que o cliente cita quando volta a falar com você.',
  },
];

const POR_CHAVE = new Map(
  MESSAGE_VARIABLES.map((variavel) => [
    variavel.tag.slice(2, -2).trim().toLowerCase(),
    variavel.campo,
  ]),
);

/** Qualquer `{{ … }}`, tolerante a espaços em volta da chave. */
const PADRAO = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * Substitui as variáveis pelo que o contexto tiver.
 *
 * Duas regras de borda, e as duas existem para proteger quem vai **receber** a
 * mensagem:
 *
 *  - **Variável sem valor vira string vazia**, nunca a chave crua. Um cliente
 *    jamais pode receber `{{protocolo}}` escrito por extenso, e é isso que
 *    aconteceria se o caminho de erro fosse "deixa como está".
 *  - **Chave desconhecida também some.** Um `{{cliente.telefone}}` digitado à
 *    mão é engano de quem escreveu o texto, e vazá-lo para o cliente transforma
 *    um engano interno em constrangimento externo.
 *
 * Espaços duplicados que sobram de uma substituição vazia são colapsados, para
 * "Olá , tudo bem?" não chegar assim ao cliente.
 */
export const interpolate = (texto: string, contexto: VariableContext): string => {
  if (!texto.includes('{{')) return texto;

  const substituido = texto.replace(PADRAO, (_inteiro, chave: string) => {
    const campo = POR_CHAVE.get(chave.trim().toLowerCase());
    if (!campo) return '';
    return contexto[campo]?.trim() ?? '';
  });

  // Só arruma o estrago da substituição vazia: espaço antes de pontuação e
  // espaço duplo. Não mexe em quebra de linha, que é formatação de quem
  // escreveu.
  return substituido.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.!?;:])/g, '$1');
};

/** A mensagem cita alguma variável? Usado para decidir se vale interpolar. */
export const hasVariables = (texto: string): boolean => {
  PADRAO.lastIndex = 0;
  return PADRAO.test(texto);
};
