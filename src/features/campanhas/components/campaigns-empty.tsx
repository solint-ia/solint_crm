import Link from 'next/link';
import { Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * Por que ainda não dá para disparar.
 *
 * Duas causas, e a mensagem diz qual: sem caixa oficial não há por onde sair;
 * sem template aprovado não há o que mandar. Cada uma leva para a tela que
 * resolve.
 */
export function CampaignsEmpty({ semCaixa }: { readonly semCaixa: boolean }) {
  return (
    <div className="mb-4">
      {semCaixa ? (
        <EmptyState
          icon={<Megaphone className="size-8" />}
          title="Campanhas saem só pela API oficial do WhatsApp"
          description="Disparo em massa por QR Code é o uso que o WhatsApp bane. Conecte um número oficial da Meta em Configurações › Caixas de entrada para criar campanhas."
          action={
            <Link href="/configuracoes?secao=caixas">
              <Button size="sm">Conectar número oficial</Button>
            </Link>
          }
        />
      ) : (
        <EmptyState
          icon={<Megaphone className="size-8" />}
          title="Nenhum template aprovado para disparar"
          description="Uma campanha envia um template aprovado pela Meta. Sincronize os templates da sua conta ou crie um e aguarde a aprovação."
          action={
            <Link href="/templates">
              <Button size="sm">Ir para Templates</Button>
            </Link>
          }
        />
      )}
    </div>
  );
}
