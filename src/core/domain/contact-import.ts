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
const PARTICULAS = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'di',
  'du',
  'del',
  'la',
  'van',
  'von',
]);

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
  const candidatos = raw
    .split(/[;,\s]+/)
    .map((parte) => parte.trim())
    .filter(Boolean);
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
  readonly company: string;
  readonly cnpj: string;
  readonly companyAddress: string;
  readonly companyPhone: string;
  /** Nome do sócio dono do telefone desta linha. */
  readonly partnerName: string;
  readonly partnerPhone: string;
  /** Classificação **deste** telefone, não do sócio. */
  readonly classification: string;
  /** Conteúdo literal da coluna `WhatsApp`. */
  readonly whatsappFlag: string;
}

/** Um telefone de sócio conforme a planilha o descreve. */
export interface ImportPartnerPhone {
  readonly phone: string;
  readonly classification: string;
}

export interface ImportPartner {
  readonly name: string;
  readonly phones: readonly ImportPartnerPhone[];
}

export interface ImportContact {
  readonly name: string;
  /** Todos os números da empresa, em E.164, sem repetir. O primeiro vira `phone`. */
  readonly phones: readonly string[];
  readonly company: string;
  readonly cnpj: string;
  readonly companyAddress: string;
  readonly companyPhone: string;
  /** O primeiro telefone de sócio encontrado. É o que a tabela mostra na coluna. */
  readonly partnerPhone: string;
  /** Classificação de `partnerPhone`. */
  readonly classification: string;
  /** Os sócios e os telefones de cada um. É aqui que o modelo real fica. */
  readonly partners: readonly ImportPartner[];
}

export interface ImportPreparation {
  readonly contacts: readonly ImportContact[];
  /** Telefones de sócio descartados porque `WhatsApp` não era exatamente `Sim`. */
  readonly semWhatsapp: number;
  /** Linhas descartadas por não ter nome ou por telefone irrecuperável. */
  readonly invalidas: number;
  /** Quantas linhas foram fundidas em contatos que já apareceram antes. */
  readonly agrupadas: number;
  /** Empresas em que há mais de um destinatário possível — sócio ou número. */
  readonly comEscolha: number;
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
export const prepareImport = (rows: readonly ImportRow[]): ImportPreparation => {
  /**
   * A empresa em construção, com os sócios indexados para a fusão.
   *
   * `socios` é um `Map` por nome dobrado, e não um array, porque as linhas do
   * mesmo sócio não vêm necessariamente juntas — e procurar linearmente a cada
   * linha transformaria uma planilha de milhares de linhas numa varredura
   * quadrática.
   */
  interface EmAndamento {
    empresa: string;
    cnpj: string;
    endereco: string;
    telefoneEmpresa: string;
    numeros: string[];
    socios: Map<string, { nome: string; telefones: ImportPartnerPhone[] }>;
  }

  const porChave = new Map<string, EmAndamento>();
  let semWhatsapp = 0;
  let invalidas = 0;
  let agrupadas = 0;

  for (const row of rows) {
    const empresa = row.company.trim().replace(/\s+/g, ' ');
    const telefoneEmpresa = normalizeImportedPhone(row.companyPhone);

    // Regra deliberadamente literal: `sim`, `SIM`, `1` e qualquer outro valor
    // não autorizam importar o telefone pessoal do sócio. Um fixo marcado como
    // "Não" não vira destinatário — e mostrá-lo na lista de escolha seria
    // oferecer um número que não recebe mensagem.
    const telefoneSocio =
      row.whatsappFlag === 'Sim' ? normalizeImportedPhone(row.partnerPhone) : null;
    if (row.partnerPhone.trim() && row.whatsappFlag !== 'Sim') semWhatsapp += 1;

    const numeros = [telefoneEmpresa, telefoneSocio].filter(
      (numero): numero is string => numero !== null,
    );

    if (!empresa || numeros.length === 0) {
      invalidas += 1;
      continue;
    }

    const cnpj = row.cnpj.trim();
    const chave = cnpj.replace(/\D/g, '') || foldText(empresa);
    let entrada = porChave.get(chave);

    if (!entrada) {
      entrada = {
        empresa,
        cnpj,
        endereco: row.companyAddress.trim(),
        telefoneEmpresa: telefoneEmpresa ?? '',
        numeros: [],
        socios: new Map(),
      };
      porChave.set(chave, entrada);
    } else {
      agrupadas += 1;
      // Campos que faltavam na primeira linha são completados pelas seguintes:
      // a planilha repete os dados da empresa em toda linha dela, mas nem
      // sempre todas vêm preenchidas.
      entrada.cnpj ||= cnpj;
      entrada.endereco ||= row.companyAddress.trim();
      entrada.telefoneEmpresa ||= telefoneEmpresa ?? '';
    }

    for (const numero of numeros) {
      if (!entrada.numeros.includes(numero)) entrada.numeros.push(numero);
    }

    if (!telefoneSocio) continue;

    /**
     * O sócio sem nome ainda é um dono possível.
     *
     * Nem toda planilha traz a coluna, e recusar a linha por causa disso
     * descartaria um telefone bom. A chave vazia agrupa todos esses num
     * "Sócio" só, que é a informação honesta: sabe-se que o número é de um
     * sócio, não se sabe de qual.
     */
    const nome = row.partnerName.trim().replace(/\s+/g, ' ');
    const chaveSocio = foldText(nome);
    const socio = entrada.socios.get(chaveSocio) ?? {
      nome: normalizePersonName(nome) || 'Sócio',
      telefones: [],
    };
    if (!socio.telefones.some((item) => item.phone === telefoneSocio)) {
      socio.telefones.push({ phone: telefoneSocio, classification: row.classification.trim() });
    }
    entrada.socios.set(chaveSocio, socio);
  }

  const contacts: ImportContact[] = [];
  let comEscolha = 0;

  for (const entrada of porChave.values()) {
    const partners: ImportPartner[] = [...entrada.socios.values()].map((socio) => ({
      name: socio.nome,
      phones: socio.telefones,
    }));

    // O primeiro telefone de sócio da planilha é o que a coluna da tabela
    // mostra. Não há como saber qual é o preferido da pessoa, e a ordem da
    // planilha é a única informação disponível — os outros ficam em `partners`,
    // à vista de quem for escolher.
    const principal = partners[0]?.phones[0];

    contacts.push({
      name: entrada.empresa,
      phones: entrada.numeros,
      company: entrada.empresa,
      cnpj: entrada.cnpj,
      companyAddress: entrada.endereco,
      companyPhone: entrada.telefoneEmpresa,
      partnerPhone: principal?.phone ?? '',
      classification: principal?.classification ?? '',
      partners,
    });

    if (entrada.numeros.length > 1) comEscolha += 1;
  }

  return { contacts, semWhatsapp, invalidas, agrupadas, comEscolha };
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
