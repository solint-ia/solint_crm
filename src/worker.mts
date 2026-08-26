/**
 * Ponto de entrada do worker de WhatsApp.
 *
 * **Este arquivo nao roda direto: ele e empacotado.** `npm run worker` passa
 * antes pelo `scripts/build-worker.mjs`, e o motivo esta explicado la — em
 * resumo, o projeto e CommonJS, o Baileys 7 e ESM, e a dependencia
 * `whatsapp-rust-bridge` so publica a condicao `import`. Carregado pelo
 * resolvedor CJS do tsx, o worker morria no boot com
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` — era por isso que `npm run worker` nunca
 * chegou a subir. A extensao `.mts` marca a intencao de ESM; quem garante o
 * carregamento correto e o empacotamento.
 *
 * A marca `SOLINT_WORKER` é gravada **antes** de qualquer módulo da aplicação
 * ser carregado, e é por isso que os imports aqui são dinâmicos: `import`
 * estático é içado para o topo do módulo, e o cliente Prisma leria a variável
 * antes de ela existir.
 *
 * Ela é lida em `infrastructure/db/prisma.ts` e faz o worker abrir a
 * `WORKER_DATABASE_URL` — a porta de sessão (5432). O worker é um processo
 * longo que mantém `LISTEN` e grava lotes de chaves, e nenhuma das duas coisas
 * sobrevive ao modo transação do pooler. Ver `.env.example` item 3.
 */
process.env.SOLINT_WORKER = '1';

async function main() {
  const { CommandConsumer } = await import('./infrastructure/whatsapp/worker/command-consumer');
  const { WhatsAppSessionManager } = await import(
    './infrastructure/whatsapp/worker/session-manager'
  );
  const { publishWorkerBeat, WORKER_BEAT_INTERVAL_MS } = await import(
    './infrastructure/whatsapp/worker-presence'
  );

  console.log('====================================================');
  console.log('  Solint CRM — Worker de WhatsApp (Baileys Engine)');
  console.log('====================================================');

  const sessionManager = new WhatsAppSessionManager();
  await sessionManager.init();

  const commandConsumer = new CommandConsumer(sessionManager);
  commandConsumer.start();

  /**
   * Batida de presença.
   *
   * É como a aplicação sabe que existe um worker no ar. Sem ela, com o motor
   * `worker` ligado e nenhum worker rodando, a tela enfileirava o comando e
   * ficava em "conectando" para sempre, sem dizer o porquê. Agora a rota recusa
   * na hora, com o motivo.
   *
   * A primeira batida sai imediatamente para que uma tela aberta antes do worker
   * subir descubra a presença sem esperar o intervalo inteiro.
   */
  void publishWorkerBeat(sessionManager.workerId);
  const beat = setInterval(
    () => void publishWorkerBeat(sessionManager.workerId),
    WORKER_BEAT_INTERVAL_MS,
  );

  console.log(`[Worker] Pronto. Id: ${sessionManager.workerId}`);

  /**
   * Servidor HTTP de Healthcheck e Manutenção de Conexão.
   *
   * Permite que plataformas como o Render (Web Service Free), Railway ou Docker
   * realizem checagem de integridade via HTTP e recebam pings periódicos
   * (ex: via UptimeRobot) para evitar que o container entre em suspensão.
   */
  const http = await import('node:http');
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 10000;

  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/' || req.url === '/ping') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'solint-whatsapp-worker',
          workerId: sessionManager.workerId,
          uptimeSeconds: Math.floor(process.uptime()),
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[Worker] Servidor HTTP de healthcheck ativo na porta ${port}`);
  });

  const { flushPendingKeys } = await import('./infrastructure/whatsapp/auth/postgres-auth-state');

  const handleShutdown = async (signal: string) => {
    console.log(`\n[Worker] Recebido sinal ${signal}. Encerrando sessões com segurança...`);
    clearInterval(beat);
    server.close();
    commandConsumer.stop();
    await sessionManager.shutdown();
    // As chaves de cache (`lid-mapping`, `tctoken`) são gravadas fora do mutex
    // do Baileys, o que significa que pode haver um lote ainda na fila neste
    // instante. Perdê-lo não quebra a sessão — o Baileys refaz por USync —, mas
    // custaria uma rodada de consultas na próxima conexão sem necessidade.
    await flushPendingKeys();
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

// Marca o arquivo como módulo ES: ele é importado por `scripts/test-worker-start.ts`.
export {};
