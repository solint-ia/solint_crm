import QRCode from 'qrcode';

/**
 * Converte o QR de pareamento em imagem, na borda que fala com o navegador.
 *
 * O `qr` que circula pelo domínio e pelo `WhatsAppConnection.qrPayload` é a
 * **string crua** que o Baileys entrega (~230 bytes). A imagem só é gerada aqui,
 * no último passo antes de a resposta sair.
 *
 * A razão é o `pg_notify`, que tem teto de 8000 bytes por mensagem: a mesma
 * string vira um data URL de ~6,6 KB, e com o envelope do barramento a
 * notificação estourava o limite e era descartada em silêncio — motivo pelo qual
 * o barramento removia o QR do broadcast e o pareamento pelo worker nunca
 * chegava a exibir código nenhum. Crua, ela cabe com folga.
 */
export const qrImage = async (qr: string | undefined): Promise<string | undefined> => {
  if (!qr) return undefined;
  // Já é uma imagem: veio de uma versão anterior gravada no banco.
  if (qr.startsWith('data:')) return qr;
  try {
    return await QRCode.toDataURL(qr, { margin: 2, scale: 7 });
  } catch {
    // Sem imagem é melhor que sem status: a tela mostra "conectando" em vez de
    // quebrar o fluxo inteiro por causa da renderização de um PNG.
    return undefined;
  }
};
