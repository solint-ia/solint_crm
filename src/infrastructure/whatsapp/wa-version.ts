import { fetchLatestBaileysVersion, type WAVersion } from '@whiskeysockets/baileys';
import { waLog } from './wa-log';

/**
 * Versão do protocolo do WhatsApp, buscada uma vez por processo.
 *
 * `fetchLatestBaileysVersion` é uma chamada de rede a um servidor externo, e
 * toda abertura de socket fazia a sua. Com uma caixa isso é invisível; com
 * quatro é a mesma resposta baixada quatro vezes, e — pior — quatro esperas de
 * rede em série antes de qualquer socket subir. Era parte do que fazia a
 * segunda conexão de uma conta demorar mais que a primeira.
 *
 * A versão do protocolo é do WhatsApp, não da caixa: não há motivo para cada
 * sessão descobrir a sua.
 *
 * A promessa é memorizada, e não o valor, para que chamadas simultâneas — o
 * caso normal, já que as sessões agora restauram em paralelo — compartilhem a
 * mesma ida à rede em vez de dispararem uma cada.
 */

/**
 * Usada quando a busca falha.
 *
 * Uma versão defasada ainda conecta; nenhuma versão não abre socket nenhum. O
 * valor é o mesmo que os dois motores já usavam como recurso, mantido aqui num
 * lugar só para não divergirem com o tempo.
 */
const VERSAO_DE_RESERVA: WAVersion = [2, 3000, 1043857760];

/**
 * Validade do valor memorizado.
 *
 * O worker é um processo longo — pode ficar semanas no ar. Sem prazo, ele
 * usaria para sempre a versão que baixou no boot, e uma versão velha demais é
 * recusada pelo servidor do WhatsApp. Seis horas renova sozinho sem transformar
 * isso numa consulta de rede frequente.
 */
const TTL_MS = 6 * 60 * 60 * 1000;

let cache: { readonly at: number; readonly promise: Promise<WAVersion> } | undefined;

export const waVersion = async (): Promise<WAVersion> => {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.promise;

  const promise = fetchLatestBaileysVersion()
    .then(({ version }) => version)
    .catch((error: unknown) => {
      waLog.warn('[wa-version] Não foi possível buscar a versão do WhatsApp:', error);
      // O valor memorizado é descartado junto com a falha: guardar a reserva
      // por seis horas faria uma indisponibilidade momentânea da rede fixar a
      // versão defasada por um turno inteiro.
      cache = undefined;
      return VERSAO_DE_RESERVA;
    });

  cache = { at: Date.now(), promise };
  return promise;
};
