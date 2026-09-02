/**
 * Falhas do worker que dizem **quando** o comando falhou, não só o quê.
 *
 * A distinção existe por um motivo só, e ele é a diferença entre perder uma
 * mensagem e enviá-la duas vezes: um envio que falhou *antes* de tocar o socket
 * pode ser repetido sem risco nenhum; um que falhou *depois* não pode, porque
 * ninguém sabe se o WhatsApp chegou a aceitá-lo.
 *
 * Sem essa separação, a fila só tinha duas opções ruins — desistir de tudo
 * (era o que fazia, e mensagens sumiam) ou repetir tudo (e o cliente receberia
 * a mesma mensagem duas vezes).
 */

/**
 * A sessão não estava de pé, e o comando não chegou a sair do processo.
 *
 * É o único erro que o consumidor da fila repete, e é seguro repeti-lo
 * justamente por isso: nada foi entregue ao canal. Quem o lança é sempre uma
 * guarda que roda **antes** de `socket.sendMessage`.
 */
export class SessaoIndisponivelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessaoIndisponivelError';
  }
}
