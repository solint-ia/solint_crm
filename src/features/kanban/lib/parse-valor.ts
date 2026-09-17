/**
 * Valor digitado no formulário do card, em centavos.
 *
 * Aceita o jeito brasileiro ("15.000,50") e o com ponto decimal ("15000.50").
 * A versão anterior trocava só a primeira vírgula por ponto, e "15.000,00"
 * virava 15 reais: `parseFloat("15.000.00")` para no segundo ponto. Vazio é
 * zero, porque o valor é opcional.
 */
export const parseValorEmCentavos = (texto: string): number => {
  const limpo = texto.replace(/[^\d.,]/g, '');
  if (!limpo) return 0;
  const normalizado = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo.split('.').length > 2
      ? limpo.replace(/\./g, '')
      : limpo;
  const reais = Number.parseFloat(normalizado);
  return Number.isFinite(reais) && reais > 0 ? Math.round(reais * 100) : 0;
};
