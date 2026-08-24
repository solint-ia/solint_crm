import 'dotenv/config';

async function main() {
  console.log('[TestWorker] Importando worker...');
  await import('../src/worker');
  console.log('[TestWorker] Worker inicializado com sucesso!');
  setTimeout(() => {
    console.log('[TestWorker] Finalizando teste de inicialização do worker com sucesso.');
    process.exit(0);
  }, 2000);
}

main().catch((err) => {
  console.error('[TestWorker] Erro ao inicializar worker:', err);
  process.exit(1);
});
