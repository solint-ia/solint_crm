'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

interface TestMessage {
  readonly id: string;
  readonly from: 'bot' | 'user';
  readonly text: string;
}

interface AgentTesterProps {
  readonly agentId: string;
  readonly greeting: string;
  readonly reply: (input: {
    agentId: string;
    prompt: string;
  }) => Promise<{ ok: boolean; reply?: string; error?: string }>;
}

/** Ambiente de teste isolado: não cria conversa nem contato reais. */
export function AgentTester({ agentId, greeting, reply }: AgentTesterProps) {
  const [messages, setMessages] = useState<readonly TestMessage[]>([
    { id: 'greeting', from: 'bot', text: greeting },
  ]);
  const [input, setInput] = useState('');
  const [pending, startTransition] = useTransition();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const prompt = input.trim();
    if (!prompt) return;

    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, from: 'user', text: prompt },
    ]);
    setInput('');

    startTransition(async () => {
      const result = await reply({ agentId, prompt });
      setMessages((current) => [
        ...current,
        {
          id: `bot-${Date.now()}`,
          from: 'bot',
          text: result.reply ?? 'Não foi possível gerar uma resposta agora.',
        },
      ]);
    });
  };

  return (
    <div className="flex h-[420px] flex-col rounded-surface border border-line bg-chat">
      <p className="border-b border-line bg-cyan-soft px-3 py-2 text-meta text-cyan-text">
        Ambiente de teste isolado: nada aqui e enviado a clientes reais.
      </p>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
        {messages.map((message) => (
          <p
            key={message.id}
            className={cn(
              'max-w-[78%] rounded-bubble px-3 py-2 text-body',
              message.from === 'bot'
                ? 'self-start border border-cyan-line bg-cyan-soft text-cyan-text'
                : 'self-end bg-accent-soft text-accent-soft-text',
            )}
          >
            {message.text}
          </p>
        ))}
        {pending ? <p className="text-meta text-dim">Agente digitando...</p> : null}
      </div>

      <form onSubmit={submit} className="flex gap-2 border-t border-line bg-surface p-2.5">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Escreva como se fosse o cliente"
          aria-label="Mensagem de teste"
          className="h-9 flex-1 rounded-control border border-line bg-surface px-3 text-body text-ink outline-none placeholder:text-dim focus:border-brand"
        />
        <Button type="submit" size="sm" disabled={pending} icon={<Send className="size-3.5" />}>
          Enviar
        </Button>
      </form>
    </div>
  );
}
