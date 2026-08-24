import { CommandConsumer } from './infrastructure/whatsapp/worker/command-consumer';
import { WhatsAppSessionManager } from './infrastructure/whatsapp/worker/session-manager';

async function main() {
  console.log('====================================================');
  console.log('  Solint CRM — Worker de WhatsApp (Baileys Engine)');
  console.log('====================================================');

  const sessionManager = new WhatsAppSessionManager();
  await sessionManager.init();

  const commandConsumer = new CommandConsumer(sessionManager);
  commandConsumer.start();

  const handleShutdown = async (signal: string) => {
    console.log(`\n[Worker] Recebido sinal ${signal}. Encerrando sessões com segurança...`);
    commandConsumer.stop();
    await sessionManager.shutdown();
    console.log('[Worker] Todas as conexões encerradas. Tchau!');
    process.exit(0);
  };

  process.on('SIGINT', () => void handleShutdown('SIGINT'));
  process.on('SIGTERM', () => void handleShutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[Worker] Falha fatal ao iniciar:', err);
  process.exit(1);
});
