import { PhoneNumber } from './contact';

/**
 * As regras de leitura de uma planilha de prospecção.
 *
 * Ficam no domínio, e não na tela, porque servidor e navegador precisam
 * concordar: a tela agrupa e mostra "3 linhas viraram 1 contato", e o servidor
 * grava. Se cada lado normalizasse do seu jeito, o resumo mostrado seria uma
 * promessa que a gravação não cumpre.
 */

/** O valor da coluna significa "sim"? */
export const isAffirmative = (raw: string): boolean =>
  ['sim', 's', 'yes', 'y', 'true', '1', 'verdadeiro'].includes(
    raw
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, ''),
  );

/** O valor da coluna significa "não"? Usado só para reconhecer uma coluna de sim/não. */
export const isNegative = (raw: string): boolean =>
  ['nao', 'n', 'no', 'false', '0', 'falso'].includes(
    raw
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, ''),
  );

/** Sem acento, minúsculo, sem pontuação — para comparar cabeçalhos e chaves. */
export const foldText = (raw: string): string =>
  raw
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * Partículas que ficam em minúscula num nome próprio brasileiro.
 *
 * "JOSE RAMON GARCIA CAJARAVILLE JUNIOR" vira "Jose Ramon Garcia Cajaraville
 * Junior", mas "MARIA DE LOURDES" vira "Maria de Lourdes" — e não "Maria De
 * Lourdes", que nenhum brasileiro escreve.
 */
const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'la', 'van', 'von']);

/**
 * Nome de pessoa em caixa alta vira Maiúsculas Iniciais.
 *
 * Planilhas de prospecção vêm gritando ("THIAGO FRANKLIN PROENCA") porque saem
 * de bases da Receita. Na agenda, ao lado de contatos que vieram do WhatsApp
 * com o nome que a própria pessoa escolheu, o caixa alta destoa e cansa de ler.
 *
 * Só age quando **não há nenhuma minúscula** — um nome já escrito direito passa
 * intacto, e ninguém tem "Mcdonald" transformado em "McDonald" ou vice-versa
 * por palpite nosso. Empresas ficam de fora de propósito: razão social é cheia
 * de sigla ("MPT", "A2M2", "S/S"), e title case as destruiria.
 */
export const normalizePersonName = (raw: string): string => {
  const limpo = raw.trim().replace(/\s+/g, ' ');
  if (!limpo || /[a-zà-ÿ]/.test(limpo)) return limpo;

  return limpo
    .split(' ')
    .map((palavra, indice) => {
      const minuscula = palavra.toLowerCase();
      // A partícula só fica minúscula no meio: "Do Carmo Silva" começa a frase.
      if (indice > 0 && PARTICULAS.has(minuscula)) return minuscula;
      // Token com número ou barra é sigla, não palavra: preserva como veio.
      if (/[^A-Za-zÀ-ÿ]/.test(palavra)) return palavra;
      return minuscula.charAt(0).toUpperCase() + minuscula.slice(1);
    })
    .join(' ');
};

/**
 * O primeiro e-mail utilizável de uma célula que pode conter vários.
 *
 * A coluna "Emails do Sócio" traz a lista inteira separada por `;` — dezesseis
 * endereços numa célula, no caso extremo desta planilha. Guardar a lista toda
 * no campo de e-mail faria dele uma string que nenhum cliente de e-mail abre; e
 * recusar a linha por "e-mail inválido" descartaria um contato bom por causa do
 * formato da origem.
 */
export const firstEmail = (raw: string): string => {
  const candidatos = raw.split(/[;,\s]+/).map((parte) => parte.trim()).filter(Boolean);
  const valido = candidatos.find((parte) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(parte));
  return valido ? valido.toLowerCase() : '';
};

/**
 * `(24) 99829-6234` vira `+5524998296234`.
 *
 * A planilha traz parênteses, espaços e hífen; o sistema guarda E.164, sem
 * separador nenhum (ver `PhoneNumber`). Devolve `null` quando não sobra um
 * número plausível — a linha é recusada com o motivo, em vez de gravar lixo.
 *
 * O `55` é acrescentado só a números de 10 ou 11 dígitos, que é o formato
 * nacional com DDD. Quem já vem com código de país passa direto, e quem vem
 * com 8 ou 9 dígitos (sem DDD) é recusado: adivinhar o DDD seria inventar para
 * qual cidade a mensagem vai.
 */
export const normalizeImportedPhone = (raw: string): string | null => {
  const digitos = raw.replace(/\D/g, '');
  if (!digitos) return null;

  // Um "0" de discagem antiga na frente do DDD: `(021) 2535-3193`.
  const semZero = digitos.replace(/^0+/, '');
  if (!semZero) return null;

  const comPais = semZero.length === 10 || semZero.length === 11 ? `55${semZero}` : semZero;
  const e164 = `+${comPais}`;
  return PhoneNumber.isValid(e164) ? e164 : null;
};

/** Uma linha da planilha, já com as colunas resolvidas para os campos do CRM. */
export interface ImportRow {
  readonly name: string;
  readonly phone: string;
  readonly email: string;
  readonly company: string;
  readonly notes: string;
  /** Conteúdo da coluna de sim/não, quando o usuário mapeou uma. */
  readonly whatsappFlag?: string;
}

export interface ImportContact {
  readonly name: string;
  /** Todos os números da pessoa, em E.164, sem repetir. O primeiro vira `phone`. */
  readonly phones: readonly string[];
  readonly email: string;
  readonly company: string;
  readonly notes: string;
}

export interface ImportPreparation {
  readonly contacts: readonly ImportContact[];
  /** Linhas descartadas por não terem WhatsApp marcado como "Sim". */
  readonly semWhatsapp: number;
  /** Linhas descartadas por não ter nome ou por telefone irrecuperável. */
  readonly invalidas: number;
  /** Quantas linhas foram fundidas em contatos que já apareceram antes. */
  readonly agrupadas: number;
}

/**
 * Transforma linhas da planilha nos contatos que serão gravados.
 *
 * Duas coisas acontecem aqui, e as duas são o pedido:
 *
 * 1. **Filtro por WhatsApp.** Quando existe uma coluna de sim/não mapeada, só
 *    passam as linhas marcadas como "Sim". A planilha traz o telefone fixo do
 *    escritório na mesma coluna do celular do sócio, e é essa coluna que
 *    distingue os dois — importar tudo encheria a agenda de números que não
 *    recebem mensagem.
 *
 * 2. **Um contato, vários números.** A mesma pessoa aparece em várias linhas,
 *    uma por telefone. A chave é nome + empresa: o nome sozinho juntaria dois
 *    "Lucas Silva" de empresas diferentes, e a empresa sozinha juntaria os
 *    sócios todos num contato só.
 *
 * O primeiro número encontrado vira o principal, e é por ele que a conversa
 * sai. Não há como saber qual dos três é o preferido da pessoa, e a ordem da
 * planilha é a única informação disponível — as outras ficam à vista no
 * cadastro para quem atende escolher.
 */
export const prepareImport = (rows: readonly ImportRow[], filtrarPorWhatsapp: boolean): ImportPreparation => {
  const porChave = new Map<string, { contato: ImportContact; numeros: string[] }>();
  let semWhatsapp = 0;
  let invalidas = 0;
  let agrupadas = 0;

  for (const row of rows) {
    if (filtrarPorWhatsapp && !isAffirmative(row.whatsappFlag ?? '')) {
      semWhatsapp += 1;
      continue;
    }

    const nome = normalizePersonName(row.name);
    const telefone = normalizeImportedPhone(row.phone);
    if (!nome || !telefone) {
      invalidas += 1;
      continue;
    }

    const empresa = row.company.trim().replace(/\s+/g, ' ');
    const chave = `${foldText(nome)}|${foldText(empresa)}`;
    const existente = porChave.get(chave);

    if (!existente) {
      porChave.set(chave, {
        contato: {
          name: nome,
          phones: [telefone],
          email: firstEmail(row.email),
          company: empresa,
          notes: row.notes.trim(),
        },
        numeros: [telefone],
      });
      continue;
    }

    agrupadas += 1;
    if (!existente.numeros.includes(telefone)) existente.numeros.push(telefone);

    // Campos que faltavam na primeira linha são completados pelas seguintes: a
    // planilha repete os dados do sócio em toda linha dele, mas nem sempre
    // todas vêm preenchidas.
    existente.contato = {
      ...existente.contato,
      phones: existente.numeros,
      email: existente.contato.email || firstEmail(row.email),
      company: existente.contato.company || empresa,
      notes: existente.contato.notes || row.notes.trim(),
    };
  }

  return {
    contacts: [...porChave.values()].map((entrada) => entrada.contato),
    semWhatsapp,
    invalidas,
    agrupadas,
  };
};

/**
 * A coluna é de sim/não, de telefone, ou de outra coisa?
 *
 * Decidido pelo **conteúdo**, não pelo cabeçalho, porque nesta planilha o
 * cabeçalho engana: a coluna chamada "WhatsApp" não tem números, tem "Sim" e
 * "Não". Um detector que confiasse no nome mapearia "Sim" como telefone e
 * recusaria a planilha inteira, sem dizer por quê.
 */
export const sniffColumnKind = (
  amostra: readonly string[],
): 'sim-nao' | 'telefone' | 'email' | 'desconhecida' => {
  const valores = amostra.map((v) => v.trim()).filter(Boolean);
  if (valores.length === 0) return 'desconhecida';

  const simNao = valores.filter((v) => isAffirmative(v) || isNegative(v)).length;
  if (simNao / valores.length >= 0.8) return 'sim-nao';

  const emails = valores.filter((v) => firstEmail(v)).length;
  if (emails / valores.length >= 0.8) return 'email';

  // Telefone: quase só dígitos e pontuação de telefone, com 8 a 15 dígitos.
  const telefones = valores.filter((v) => {
    if (!/^[\d\s()+\-./]+$/.test(v)) return false;
    const digitos = v.replace(/\D/g, '').length;
    return digitos >= 8 && digitos <= 15;
  }).length;
  if (telefones / valores.length >= 0.7) return 'telefone';

  return 'desconhecida';
};
