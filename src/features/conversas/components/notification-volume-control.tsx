'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, Volume1, Volume2, VolumeX } from 'lucide-react';
import type { NotificationSound } from '@/core/domain/user';
import { updateNotificationSoundAction } from '@/app/(workspace)/perfil/actions';
import {
  NOTIFICATION_SOUND_OPTIONS,
  announceNotificationSoundChange,
  getNotificationVolume,
  isNotificationMuted,
  setNotificationMuted,
  setNotificationVolume,
  testNotificationSound,
} from '@/features/realtime/notification-sound';
import { cn } from '@/lib/cn';

export function NotificationVolumeControl({
  initialSound,
}: {
  readonly initialSound: NotificationSound;
}) {
  const [open, setOpen] = useState(false);
  const [volume, setVolumeState] = useState(80);
  const [muted, setMutedState] = useState(false);
  const [sound, setSound] = useState(initialSound);
  const [savingSound, setSavingSound] = useState(false);
  const [soundError, setSoundError] = useState<string>();
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSound(initialSound), [initialSound]);

  useEffect(() => {
    setVolumeState(getNotificationVolume());
    setMutedState(isNotificationMuted());

    const handleUpdate = () => {
      setVolumeState(getNotificationVolume());
      setMutedState(isNotificationMuted());
    };

    window.addEventListener('solint_notif_volume_changed', handleUpdate);
    return () => window.removeEventListener('solint_notif_volume_changed', handleUpdate);
  }, []);

  // Fechar ao clicar fora
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleVolumeChange = (newVal: number) => {
    setVolumeState(newVal);
    setNotificationVolume(newVal);
    if (newVal > 0 && muted) {
      setMutedState(false);
      setNotificationMuted(false);
    }
  };

  const toggleMute = () => {
    const next = !muted;
    setMutedState(next);
    setNotificationMuted(next);
  };

  const handleTest = () => {
    testNotificationSound(sound, muted ? volume : undefined);
  };

  const handleSoundChange = async (next: NotificationSound) => {
    if (next === sound || savingSound) return;
    const previous = sound;
    setSound(next);
    setSoundError(undefined);
    setSavingSound(true);
    announceNotificationSoundChange(next);
    testNotificationSound(next, volume);

    const result = await updateNotificationSoundAction({ soundTone: next });
    setSavingSound(false);
    if (result.ok) return;

    setSound(previous);
    announceNotificationSoundChange(previous);
    setSoundError(result.error ?? 'Não foi possível salvar a escolha.');
  };

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        title={muted ? 'Som de notificação desativado' : `Volume do som de notificação: ${volume}%`}
        aria-label="Ajustar som de notificação"
        className={cn(
          'flex size-9 items-center justify-center rounded-xl border transition-all',
          open
            ? 'border-brand bg-brand/10 text-brand shadow-xs'
            : muted
              ? 'border-line bg-surface text-muted hover:bg-surface-2 hover:text-ink'
              : 'border-line bg-surface text-ink hover:bg-surface-2 hover:border-line-strong',
        )}
      >
        {muted || volume === 0 ? (
          <VolumeX className="size-4 text-muted" />
        ) : volume < 50 ? (
          <Volume1 className="size-4" />
        ) : (
          <Volume2 className="size-4" />
        )}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1.5 z-40 w-72 rounded-2xl border border-line bg-surface p-3.5 shadow-xl animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-line-soft">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-ink">Som de Notificação</span>
            </div>
            <span className="text-[11px] font-mono font-medium text-muted">
              {muted ? 'Mudo' : `${volume}%`}
            </span>
          </div>

          <div className="space-y-3">
            <fieldset className="space-y-1.5" disabled={savingSound}>
              <legend className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Escolha o toque
              </legend>
              <div className="grid grid-cols-2 gap-1.5">
                {NOTIFICATION_SOUND_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={sound === option.id}
                    onClick={() => void handleSoundChange(option.id)}
                    className={cn(
                      'rounded-xl border px-2.5 py-2 text-left transition-colors disabled:cursor-wait disabled:opacity-60',
                      sound === option.id
                        ? 'border-brand/40 bg-brand/10 text-brand'
                        : 'border-line bg-surface-2 text-ink hover:bg-surface',
                    )}
                  >
                    <span className="block text-xs font-semibold">{option.label}</span>
                    <span className="mt-0.5 block text-[10px] leading-tight text-muted">
                      {option.description}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>

            {soundError ? (
              <p role="alert" className="text-[10px] text-red-text">
                {soundError}
              </p>
            ) : null}

            {/* Slider de Volume */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-muted font-medium">
                <span>0%</span>
                <span>100%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={muted ? 0 : volume}
                onChange={(e) => handleVolumeChange(Number.parseInt(e.target.value, 10))}
                className="w-full accent-blue-600 h-1.5 bg-surface-2 rounded-lg cursor-pointer"
              />
            </div>

            {/* Ações: Alternar Mudo e Testar Som */}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={toggleMute}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium border transition-colors',
                  muted
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                    : 'bg-surface-2 border-line hover:bg-surface text-ink',
                )}
              >
                {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
                <span>{muted ? 'Desmutar' : 'Silenciar'}</span>
              </button>

              <button
                type="button"
                onClick={handleTest}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-brand/10 hover:bg-brand/20 border border-brand/20 px-2.5 py-1.5 text-xs font-semibold text-brand transition-colors"
                title="Tocar som de teste"
              >
                <Play className="size-3 fill-current" />
                <span>Testar</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
