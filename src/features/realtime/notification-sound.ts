'use client';

/**
 * O toque de mensagem nova, sintetizado.
 *
 * Sem arquivo de áudio de propósito: um `.mp3` no `public/` seria mais um
 * recurso a carregar, a versionar e a passar pela CSP, para dois tons de meio
 * segundo. A Web Audio API os gera com precisão e sem rede.
 *
 * São duas notas subindo (880 Hz → 1320 Hz, uma quinta) porque um bipe único
 * lê como erro; dois tons ascendentes leem como "chegou algo". O volume é
 * baixo — 6% do pico — já que quem atende ouve isto o dia inteiro.
 */

const TONES = [
  { hz: 880, atraso: 0, duracao: 0.12 },
  { hz: 1320, atraso: 0.1, duracao: 0.18 },
] as const;

const PICO = 0.06;

type AudioContextCtor = typeof AudioContext;

let contexto: AudioContext | null = null;

/**
 * O contexto é criado uma vez e reaproveitado.
 *
 * Criar um por toque estoura o limite do navegador em poucos minutos de uso —
 * o Chrome permite meia dúzia por página e depois recusa em silêncio, o que
 * apareceria como "o som parou de funcionar depois de um tempo".
 */
const obterContexto = (): AudioContext | null => {
  if (contexto) return contexto;
  if (typeof window === 'undefined') return null;

  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) return null;

  try {
    contexto = new Ctor();
    return contexto;
  } catch {
    return null;
  }
};

/**
 * Toca o aviso.
 *
 * Falha em silêncio por princípio: o navegador bloqueia áudio em página que
 * ainda não recebeu interação, e uma exceção aqui derrubaria o processamento
 * do evento — a mensagem deixaria de aparecer por causa do som dela.
 */
export const playNotificationSound = (): void => {
  const ctx = obterContexto();
  if (!ctx) return;

  // A página pode ter sido aberta em segundo plano: o contexto nasce suspenso e
  // só volta com um gesto. Pedir a retomada aqui aproveita o primeiro que vier.
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);

  try {
    const agora = ctx.currentTime;

    for (const tom of TONES) {
      const oscilador = ctx.createOscillator();
      const ganho = ctx.createGain();

      oscilador.type = 'sine';
      oscilador.frequency.value = tom.hz;

      // A rampa existe para não estalar: um ganho que salta de 0 para o pico
      // produz um clique audível na maioria das caixas de som.
      const inicio = agora + tom.atraso;
      const fim = inicio + tom.duracao;
      ganho.gain.setValueAtTime(0, inicio);
      ganho.gain.linearRampToValueAtTime(PICO, inicio + 0.015);
      ganho.gain.exponentialRampToValueAtTime(0.0001, fim);

      oscilador.connect(ganho).connect(ctx.destination);
      oscilador.start(inicio);
      oscilador.stop(fim + 0.02);
    }
  } catch {
    // Contexto fechado pelo navegador, aba descartada: nada a fazer.
  }
};
