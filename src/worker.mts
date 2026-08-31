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
  // Antes de qualquer coisa do WhatsApp: a `libsignal` despeja objetos de
  // sessão inteiros — chave privada inclusive — em `console.info` a cada
  // contato que troca de aparelho. Ver `wa-console-filter.ts`.
  const { silenceNoisyLibsignalLogs } = await import(
    './infrastructure/whatsapp/wa-console-filter'
  );
  silenceNoisyLibsignalLogs();

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
   * Varredor das mensagens agendadas.
   *
   * Ele mora aqui porque disparar no horário exige um processo vivo com
   * relógio, e o worker é o único que este sistema garante ter. O envio em si
   * não é feito por ele: a mensagem entra na **mesma fila** de qualquer outro
   * envio (`WhatsAppCommand` de tipo `send`), e daí em diante segue o caminho já
   * existente — raia de envio, carimbo do id do canal, recibo de entrega. Um
   * segundo caminho de envio seria um segundo lugar para os mesmos defeitos.
   */
  const { ScheduledMessageRunner } = await import('./infrastructure/scheduling/scheduled-runner');
  const { CHANNELS, postgresPubSub } = await import('./infrastructure/db/postgres-pubsub');
  const { prisma } = await import('./infrastructure/db/prisma');

  const scheduledRunner = new ScheduledMessageRunner(async (envio) => {
    const command = await prisma.whatsAppCommand.create({
      data: {
        inboxId: envio.inboxId,
        kind: 'send',
        payload: {
          recipient: envio.recipient,
          content: { text: envio.text },
          accountId: envio.accountId,
          conversationId: envio.conversationId,
          messageId: envio.messageId,
        },
        status: 'pending',
      },
    });
    await postgresPubSub.publish(CHANNELS.COMMANDS, {
      inboxId: envio.inboxId,
      kind: 'send',
      id: command.id,
    });
    // Sem `externalId`: a fila aceitou, o envio ainda não aconteceu. Quem
    // carimba o id do canal — e promove a bolha a "enviado" — é o consumidor.
    return { ok: true };
  });
  scheduledRunner.start();

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
      /**
       * Memória junto com o pulso.
       *
       * Sem isto, "quantas conexões cabem nesta instância?" só tinha resposta
       * por estimativa — e estimativa de memória de processo Node erra por
       * múltiplos, porque o que domina não é o que o código guarda, é o que o
       * V8 reserva. Medir custa uma chamada e responde de uma vez.
       *
       * `rss` é o número que a hospedagem cobra e limita: memória realmente
       * residente, incluindo o binário, o heap e o que estiver fora dele.
       * `heapUsed` mostra quanto do heap está de fato ocupado — a diferença
       * entre os dois é o que não adianta tentar reduzir mexendo em cache.
       * `arrayBuffers` é onde as mídias aparecem: um download materializa um
       * Buffer que não vive no heap do V8, e é ele que dá os picos.
       */
      const mem = process.memoryUsage();
      const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'solint-whatsapp-worker',
          workerId: sessionManager.workerId,
          uptimeSeconds: Math.floor(process.uptime()),
          sessions: sessionManager.size,
          memoryMB: {
            rss: mb(mem.rss),
            heapTotal: mb(mem.heapTotal),
            heapUsed: mb(mem.heapUsed),
            external: mb(mem.external),
            arrayBuffers: mb(mem.arrayBuffers),
          },
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

  const handleShutdown = async (signal: string, exitCode = 0) => {
    console.log(`\n[Worker] Recebido sinal ${signal}. Encerrando sessões com segurança...`);
    clearInterval(beat);
    server.close();
    scheduledRunner.stop();
    commandConsumer.stop();
    await sessionManager.shutdown();
    // As chaves de cache (`lid-mapping`, `tctoken`) são gravadas fora do mutex
    // do Baileys, o que significa que pode haver um lote ainda na fila neste
    // instante. Perdê-lo não quebra a sessão — o Baileys refaz por USync —, mas
    // custaria uma rodada de consultas na próxima conexão sem necessidade.
    await flushPendingKeys();
    console.log('[Worker] Todas as conexões encerradas. Tchau!');
    // Um encerramento por falha precisa sair diferente de zero: é o código de
    // saída que diz ao supervisor do Render se aquilo foi um desligamento
    // pedido ou um problema.
    process.exit(exitCode);
  };

  process.on('SIGINT', () => void handleShutdown('SIGINT'));
  process.on('SIGTERM', () => void handleShutdown('SIGTERM'));

  /**
   * Rede de segurança para falhas que escapam de todo o resto.
   *
   * Os dois casos são tratados de formas deliberadamente diferentes.
   *
   * **Rejeição não tratada** quase sempre vem de uma operação isolada — uma
   * consulta que falhou, uma chamada de rede que caiu — e derrubar a sessão
   * inteira do WhatsApp por causa dela é um preço alto demais. Desde o Node 15
   * o padrão é justamente esse: encerrar o processo. Aqui ela é registrada e a
   * vida segue.
   *
   * **Exceção não capturada** é outra história: o processo pode ter ficado num
   * estado inconsistente, e insistir seria pior. Ele encerra — mas encerra
   * pelo caminho limpo, que libera a trava da conexão no banco. Morrer com a
   * trava presa é o que fazia o worker seguinte esperar o TTL de 30s vencer
   * antes de restaurar a sessão.
   */
  process.on('unhandledRejection', (reason) => {
    console.error('[Worker] Rejeição não tratada (processo mantido de pé):', reason);
  });

  process.on('uncaughtException', (error) => {
    console.error('[Worker] Exceção não capturada. Encerrando de forma limpa:', error);
    void handleShutdown('uncaughtException', 1);
  });
}

main().catch((err) => {
  console.error('[Worker] Falha fatal ao iniciar:', err);
  process.exit(1);
});

// Marca o arquivo como módulo ES: ele é importado por `scripts/test-worker-start.ts`.
export {};
