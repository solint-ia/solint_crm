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

const MAX_PICO = 0.25;
const STORAGE_VOLUME_KEY = 'solint_notif_volume';
const STORAGE_MUTED_KEY = 'solint_notif_muted';

type AudioContextCtor = typeof AudioContext;

let contexto: AudioContext | null = null;

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

export const getNotificationVolume = (): number => {
  if (typeof window === 'undefined') return 80;
  try {
    const saved = localStorage.getItem(STORAGE_VOLUME_KEY);
    if (saved !== null) {
      const parsed = Number.parseInt(saved, 10);
      if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 100) return parsed;
    }
  } catch {
    // Ignora restrições de localStorage
  }
  return 80;
};

export const setNotificationVolume = (volume: number): void => {
  if (typeof window === 'undefined') return;
  const clamped = Math.max(0, Math.min(100, Math.round(volume)));
  try {
    localStorage.setItem(STORAGE_VOLUME_KEY, String(clamped));
    window.dispatchEvent(new CustomEvent('solint_notif_volume_changed', { detail: { volume: clamped } }));
  } catch {
    // Ignora
  }
};

export const isNotificationMuted = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_MUTED_KEY) === 'true';
  } catch {
    return false;
  }
};

export const setNotificationMuted = (muted: boolean): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_MUTED_KEY, String(muted));
    window.dispatchEvent(new CustomEvent('solint_notif_volume_changed', { detail: { muted } }));
  } catch {
    // Ignora
  }
};

/**
 * Toca o aviso com o volume configurado.
 */
export const playNotificationSound = (forceVolume?: number): void => {
  const muted = isNotificationMuted();
  if (muted && forceVolume === undefined) return;

  const volume = forceVolume ?? getNotificationVolume();
  if (volume <= 0) return;

  const ctx = obterContexto();
  if (!ctx) return;

  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);

  try {
    const agora = ctx.currentTime;
    const peakGain = (volume / 100) * MAX_PICO;

    for (const tom of TONES) {
      const oscilador = ctx.createOscillator();
      const ganho = ctx.createGain();

      oscilador.type = 'sine';
      oscilador.frequency.value = tom.hz;

      const inicio = agora + tom.atraso;
      const fim = inicio + tom.duracao;
      ganho.gain.setValueAtTime(0, inicio);
      ganho.gain.linearRampToValueAtTime(peakGain, inicio + 0.015);
      ganho.gain.exponentialRampToValueAtTime(0.0001, fim);

      oscilador.connect(ganho).connect(ctx.destination);
      oscilador.start(inicio);
      oscilador.stop(fim + 0.02);
    }
  } catch {
    // Contexto fechado pelo navegador, aba descartada
  }
};

export const testNotificationSound = (previewVolume?: number): void => {
  playNotificationSound(previewVolume ?? getNotificationVolume());
};
