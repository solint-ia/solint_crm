'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Check, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, TextInput } from '@/components/ui/field';
import { cn } from '@/lib/cn';

interface StepDef {
  readonly n: number;
  readonly label: string;
}

const STEPS: readonly StepDef[] = [
  { n: 1, label: 'Empresa' },
  { n: 2, label: 'Canal' },
  { n: 3, label: 'Equipe' },
  { n: 4, label: 'Conclusão' },
];

export function OnboardingWizard() {
  const [step, setStep] = useState(1);
  const [channel, setChannel] = useState<'wa-qr' | 'wa-api' | 'instagram' | 'webchat'>('wa-qr');

  const handleNext = () => setStep((s) => Math.min(4, s + 1));
  const handlePrev = () => setStep((s) => Math.max(1, s - 1));
  const handleSkip = () => setStep((s) => Math.min(4, s + 1));

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 sm:p-6 lg:p-8">
      {/* A marca de verdade, não a inicial improvisada. Aqui o fundo é claro,
          então a logo vai na cor original. */}
      <Image
        src="/logo.png"
        alt="Solint CRM"
        width={2246}
        height={600}
        priority
        className="mb-8 h-7 w-auto dark:brightness-0 dark:invert"
      />

      {/* STEPPER */}
      <div className="mb-6 flex w-full max-w-xl items-center justify-between gap-2">
        {STEPS.map((s, idx) => {
          const active = step === s.n;
          const done = step > s.n;
          return (
            <div key={s.n} className="flex flex-1 items-center gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full text-body font-bold transition-colors',
                    active && 'bg-brand text-white shadow-xs',
                    done && 'bg-green-soft text-green-text border border-green-line',
                    !active && !done && 'bg-surface border border-line text-dim',
                  )}
                >
                  {done ? <Check className="size-3.5" /> : s.n}
                </span>
                <span
                  className={cn(
                    'text-body font-semibold whitespace-nowrap hidden sm:inline',
                    active ? 'text-ink' : 'text-dim',
                  )}
                >
                  {s.label}
                </span>
              </div>
              {idx < STEPS.length - 1 ? (
                <div
                  className={cn(
                    'h-0.5 flex-1 rounded-full',
                    done ? 'bg-green-line' : 'bg-line-soft',
                  )}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {/* STEP CONTAINER */}
      <Card className="w-full max-w-xl p-6 sm:p-8">
        {step === 1 ? (
          <div>
            <h2 className="font-display text-metric font-bold text-ink">Sobre a sua empresa</h2>
            <p className="mt-1 mb-6 text-ui text-muted">
              Essas informações aparecem para seus clientes e nos relatórios de atendimento.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome da empresa" htmlFor="ob-company">
                <TextInput id="ob-company" defaultValue="Solint Demo" />
              </Field>
              <Field label="Segmento de atuação" htmlFor="ob-segment">
                <TextInput id="ob-segment" defaultValue="Serviços & Tecnologia" />
              </Field>
              <Field label="Tamanho da equipe" htmlFor="ob-size">
                <TextInput id="ob-size" defaultValue="2 a 10 pessoas" />
              </Field>
              <Field label="Fuso horário" htmlFor="ob-tz">
                <TextInput id="ob-tz" defaultValue="GMT-3 · São Paulo" />
              </Field>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div>
            <h2 className="font-display text-metric font-bold text-ink">Conecte seu primeiro canal</h2>
            <p className="mt-1 mb-6 text-ui text-muted">
              Você pode conectar outros canais e caixas de entrada depois em Configurações.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                {
                  id: 'wa-qr',
                  name: 'WhatsApp via QR Code',
                  desc: 'Rápido, usa o app do celular',
                  icon: 'W',
                  tone: 'green',
                },
                {
                  id: 'wa-api',
                  name: 'WhatsApp API oficial',
                  desc: 'Cloud API / Meta BSP',
                  icon: 'W',
                  tone: 'green',
                },
                {
                  id: 'instagram',
                  name: 'Instagram Direct',
                  desc: 'Mensagens do seu perfil',
                  icon: 'IG',
                  tone: 'pink',
                },
                {
                  id: 'webchat',
                  name: 'Webchat institucional',
                  desc: 'Widget para seu site',
                  icon: 'WC',
                  tone: 'indigo',
                },
              ].map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setChannel(c.id as typeof channel)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-surface border p-3.5 text-left transition-colors',
                    channel === c.id
                      ? 'border-brand bg-selected'
                      : 'border-line hover:bg-surface-2',
                  )}
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-control bg-accent-soft font-display text-body font-bold text-brand">
                    {c.icon}
                  </div>
                  <div>
                    <div className="text-ui font-semibold text-ink">{c.name}</div>
                    <div className="text-meta text-dim">{c.desc}</div>
                  </div>
                </button>
              ))}
            </div>

            {channel === 'wa-qr' ? (
              <div className="mt-5 flex flex-col sm:flex-row items-center gap-4 rounded-surface border border-dashed border-line p-4">
                <div
                  aria-label="QR Code simulado"
                  className="size-28 shrink-0 rounded-control border-4 border-white bg-repeat shadow-xs"
                  style={{
                    backgroundImage:
                      'repeating-conic-gradient(#0A1424 0% 25%, #FFFFFF 0% 50%)',
                    backgroundSize: '14px 14px',
                  }}
                />
                <div>
                  <div className="text-ui font-semibold text-ink">
                    Escaneie com o WhatsApp da empresa
                  </div>
                  <p className="mt-1 text-body text-muted leading-relaxed">
                    Abra o WhatsApp → Aparelhos conectados → Conectar um aparelho. O QR Code expira em{' '}
                    <span className="font-mono font-semibold text-ink">0:48</span>.
                  </p>
                  <div className="mt-2.5 flex items-center gap-2">
                    <span className="size-2 rounded-full bg-amber-text animate-pulse" />
                    <span className="text-body font-semibold text-amber-text">
                      Aguardando pareamento...
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div>
            <h2 className="font-display text-metric font-bold text-ink">Convide sua equipe</h2>
            <p className="mt-1 mb-6 text-ui text-muted">
              Adicione os emails dos atendentes. Você pode pular esta etapa e convidar depois.
            </p>

            <div className="flex flex-col gap-4">
              <Field
                label="Emails dos convidados (separados por vírgula)"
                htmlFor="ob-team"
              >
                <textarea
                  id="ob-team"
                  rows={3}
                  placeholder="camila@empresa.com, diego@empresa.com"
                  className="w-full rounded-control border border-line bg-surface p-3 text-ui text-ink outline-none"
                />
              </Field>
              <Field label="Papel padrão para os convidados" htmlFor="ob-role">
                <TextInput id="ob-role" defaultValue="Agente de Atendimento" />
              </Field>
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="flex flex-col items-center text-center py-4">
            <div className="flex size-16 items-center justify-center rounded-full bg-green-soft text-green-text mb-4">
              <CheckCircle2 className="size-8" />
            </div>
            <h2 className="font-display text-display font-bold text-ink">Tudo pronto!</h2>
            <p className="mt-2 mb-6 max-w-sm text-ui text-muted leading-relaxed">
              Sua conta está configurada com sucesso. Conecte-se com seus clientes e inicie o
              atendimento agora mesmo.
            </p>
            <Link href="/conversas">
              <Button variant="gradient" className="h-11 px-6 text-title">
                Ir para a caixa de entrada
              </Button>
            </Link>
          </div>
        ) : null}

        {/* ACTIONS FOOTER */}
        {step < 4 ? (
          <div className="mt-8 flex items-center justify-between border-t border-line pt-4">
            <button
              type="button"
              onClick={handleSkip}
              className="text-body font-semibold text-dim hover:text-ink transition-colors"
            >
              Pular esta etapa
            </button>
            <div className="flex items-center gap-2">
              {step > 1 ? (
                <Button variant="secondary" size="sm" onClick={handlePrev}>
                  Voltar
                </Button>
              ) : null}
              <Button size="sm" onClick={handleNext}>
                Continuar
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
