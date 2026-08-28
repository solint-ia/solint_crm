import type { WAMessage } from '@whiskeysockets/baileys';

/**
 * A citação, montada a partir do pouco que guardamos.
 *
 * O Baileys pede uma `WAMessage` inteira em `options.quoted`, mas só lê três
 * coisas dela: o id, de quem é, e um corpo para desenhar a prévia. Guardar a
 * mensagem original serializada — do jeito que o Baileys a recebeu — só para
 * poder citá-la depois significaria carregar um objeto grande em cada linha da
 * tabela de mensagens, para um uso que é a exceção.
 *
 * O que se perde com o atalho é a miniatura da mídia dentro da citação: uma
 * resposta a uma foto mostra a legenda, não a foto. O que se ganha é citação
 * funcionando sem mudar o formato de armazenamento de tudo que já existe.
 */
export const quotedStub = (
  jid: string,
  quote: { readonly externalId: string; readonly fromMe: boolean; readonly text: string },
): WAMessage =>
  ({
    key: {
      remoteJid: jid,
      id: quote.externalId,
      fromMe: quote.fromMe,
      // Em grupo o WhatsApp exige saber quem escreveu a citada. Fora de grupo o
      // campo é ignorado, então informá-lo sempre custa nada e evita um ramo.
      ...(quote.fromMe ? {} : { participant: jid }),
    },
    // Texto vazio quebraria a prévia no aplicativo: uma citação sem corpo é
    // desenhada como uma faixa vazia. O espaço é o mínimo que renderiza.
    message: { conversation: quote.text || ' ' },
  }) as WAMessage;

/** Chave de uma mensagem nossa, para o protocolo de exclusão. */
export const deletionKey = (jid: string, externalId: string) => ({
  remoteJid: jid,
  id: externalId,
  // Apagar "para todos" só é permitido no que **nós** enviamos. Mensagem do
  // contato o WhatsApp só deixa remover do próprio aparelho, e essa é uma ação
  // que não faz sentido num CRM: sumiria daqui e continuaria lá.
  fromMe: true,
});
