/**
 * Os campos de identificação da empresa: documento, telefone e e-mail.
 *
 * Moram no domínio, e não no componente da tela, porque são conferidos em dois
 * lugares que precisam concordar: a Server Action que grava e o formulário que
 * avisa antes de gravar. Regra duplicada em dois arquivos é regra que vai
 * divergir — o `zod` da action aceitava qualquer coisa de até 24 caracteres em
 * `document` e qualquer coisa de até 32 em `phone`, então "abc" e "(11) 9"
 * entravam no banco sem uma linha de reclamação.
 *
 * Funções puras, sem `document` nem `window`: as mesmas rodam no servidor.
 */

import { PhoneNumber } from './contact';

const somenteDigitos = (valor: string): string => valor.replace(/\D/g, '');

/* ==========================================================================
   Documento — CNPJ, e CPF para quem opera como pessoa física.
   ========================================================================== */

/**
 * Dígitos verificadores de CPF e CNPJ.
 *
 * Conferir o comprimento não basta: `00000000000000` tem catorze dígitos e não
 * é CNPJ nenhum. O cálculo é o mesmo nos dois documentos — soma ponderada
 * módulo 11 —, só mudam os pesos, então uma função serve aos dois.
 */
const digitoVerificador = (base: string, pesos: readonly number[]): number => {
  const soma = base
    .split('')
    .reduce((total, digito, indice) => total + Number(digito) * (pesos[indice] ?? 0), 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
};

const PESOS_CPF_1 = [10, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const PESOS_CPF_2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const PESOS_CNPJ_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const PESOS_CNPJ_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

/**
 * Todos os dígitos iguais passam na conta dos verificadores.
 *
 * `111.111.111-11` e `11.111.111/1111-11` fecham a aritmética e são recusados
 * em qualquer cadastro sério. É a exceção conhecida do algoritmo, não um caso
 * de borda inventado: são justamente os valores que alguém digita para "passar
 * pela validação".
 */
const repetido = (digitos: string): boolean => /^(\d)\1+$/.test(digitos);

export const isValidCpf = (raw: string): boolean => {
  const d = somenteDigitos(raw);
  if (d.length !== 11 || repetido(d)) return false;
  return (
    digitoVerificador(d.slice(0, 9), PESOS_CPF_1) === Number(d[9]) &&
    digitoVerificador(d.slice(0, 10), PESOS_CPF_2) === Number(d[10])
  );
};

export const isValidCnpj = (raw: string): boolean => {
  const d = somenteDigitos(raw);
  if (d.length !== 14 || repetido(d)) return false;
  return (
    digitoVerificador(d.slice(0, 12), PESOS_CNPJ_1) === Number(d[12]) &&
    digitoVerificador(d.slice(0, 13), PESOS_CNPJ_2) === Number(d[13])
  );
};

/**
 * O campo é rotulado "CNPJ / Inscrição cadastral", e quem atende como pessoa
 * física tem CPF. Os dois entram; qualquer outro comprimento, não.
 */
export const isValidCompanyDocument = (raw: string): boolean => {
  const d = somenteDigitos(raw);
  if (d.length === 11) return isValidCpf(d);
  if (d.length === 14) return isValidCnpj(d);
  return false;
};

/** `00.000.000/0000-00` ou `000.000.000-00`, conforme o comprimento. */
export const formatCompanyDocument = (raw: string): string => {
  const d = somenteDigitos(raw).slice(0, 14);

  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
  }

  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, '$1.$2.$3/$4-$5');
};

export const DOCUMENT_ERROR =
  'Informe um CNPJ ou CPF válido — os dígitos verificadores não conferem.';

/* ==========================================================================
   Telefone
   ========================================================================== */

/**
 * Telefone da empresa em E.164, a mesma forma que o resto do produto guarda.
 *
 * O CRM já normaliza o telefone de **contato** para `+5511987654321` — guardar
 * o da própria empresa como "(11) 98765-4321" faria o mesmo dado ter duas
 * formas no banco, e a comparação entre eles falharia em silêncio no dia em que
 * alguém quisesse saber se o número da conta é o mesmo de um contato.
 *
 * Número sem código de país ganha o 55: quem digita "11 98765-4321" está
 * informando um número brasileiro, e recusá-lo por falta de prefixo seria
 * pedantismo com um campo de cadastro.
 */
export const normalizeCompanyPhone = (raw: string): string => {
  const bruto = raw.trim();
  if (!bruto) return '';

  const digitos = somenteDigitos(bruto).replace(/^0+/, '');
  if (!digitos) return '';

  const temPais = bruto.trim().startsWith('+');
  const comPais = !temPais && (digitos.length === 10 || digitos.length === 11)
    ? `55${digitos}`
    : digitos;

  return `+${comPais}`;
};

export const isValidCompanyPhone = (raw: string): boolean =>
  !raw.trim() || PhoneNumber.isValid(normalizeCompanyPhone(raw));

/** `(11) 98765-4321` para o Brasil; o E.164 cru para os demais países. */
export const formatCompanyPhone = (raw: string): string => {
  const e164 = normalizeCompanyPhone(raw);
  if (!e164) return '';

  const br = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  return br ? `(${br[1]}) ${br[2]}-${br[3]}` : e164;
};

/**
 * Máscara enquanto se digita — só para números brasileiros.
 *
 * Um `+` na frente desliga a máscara inteira: quem informa `+351 912 345 678`
 * está cadastrando um número de Portugal, e forçar `(35) 1912-34567` em cima
 * dele transformaria o campo num obstáculo.
 */
export const maskCompanyPhoneInput = (raw: string): string => {
  if (raw.trim().startsWith('+')) return raw.replace(/[^\d+\s()-]/g, '').slice(0, 24);

  const d = somenteDigitos(raw).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

export const PHONE_ERROR =
  'Informe um telefone válido com DDD — por exemplo (11) 98765-4321.';

/* ==========================================================================
   E-mail
   ========================================================================== */

/**
 * Deliberadamente mais estrita que a do `zod`.
 *
 * `z.string().email()` aceita `a@b` — sem ponto no domínio —, e um e-mail de
 * contato institucional que não sai do servidor de ninguém não serve para o
 * que este campo existe. Exigir um rótulo de topo com ao menos duas letras
 * cobre o erro real de digitação sem cair na tentativa de implementar a RFC
 * 5322 numa expressão regular.
 */
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[A-Za-z]{2,}$/;

export const isValidCompanyEmail = (raw: string): boolean => !raw.trim() || EMAIL.test(raw.trim());

export const normalizeCompanyEmail = (raw: string): string => raw.trim().toLowerCase();

export const EMAIL_ERROR = 'Informe um e-mail válido — por exemplo contato@suaempresa.com.br.';
