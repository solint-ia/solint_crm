# Integração do Solint CRM com agente de IA no n8n

Auditoria do comportamento atual do código em 04/09/2026.

Este documento explica como receber no n8n as mensagens que chegam a uma conexão
WhatsApp do Solint CRM e como devolver a resposta do agente ao mesmo atendimento.
Também separa o que já funciona do que existe apenas como cadastro na interface.

## Resposta curta

O fluxo de agente de IA já pode ser montado hoje, com uma ressalva importante:

1. O **webhook da conta** funciona e recebe eventos reais.
2. Cada webhook da conta escolhe **de quais caixas** ele recebe: "todas as
   caixas" (inclusive as futuras) ou uma seleção. O filtro é aplicado antes de a
   entrega ser criada, então o n8n não recebe o evento de uma caixa que não
   selecionou — e não executa o workflow à toa.
3. O cadastro antigo chamado **Webhook por caixa de entrada** saiu da tela. Ele
   salvava uma URL na caixa que o despachante nunca leu; quem tinha uma cadastrada
   ali a vê listada na tela de integrações para recadastrar como webhook da conta.
4. Antes de gerar a resposta, o n8n pode chamar `POST /api/v1/presenca` para o
   contato enxergar o indicador de digitação durante o processamento do agente.
5. O n8n responde com `POST /api/v1/mensagens`, usando o `jid` recebido em
   `data.key.remoteJid` — ou o `solint.conversaId`, que vem no mesmo corpo. A
   conversa já determina automaticamente qual conexão WhatsApp fará o envio.
6. O token Bearer é obrigatório para os dois POSTs. Ele é criado manualmente
   por **conta**, e não é gerado automaticamente para cada caixa de entrada.

Fluxo efetivamente disponível:

```text
WhatsApp da caixa escolhida
        |
        v
Solint CRM grava a mensagem
        |
        v
Webhook da conta, restrito às caixas selecionadas
(conversa.criada ou mensagem.recebida)
        |
        v
POST /api/v1/presenca (composing)
        |
        v
Agente de IA gera a resposta
        |
        v
POST /api/v1/mensagens + Bearer token da conta
        |
        v
Mesma conversa -> mesma caixa -> mesmo WhatsApp
```

## Conta, workspace, caixa de entrada e conexão

No modelo atual, “conta” e “workspace” representam o mesmo limite de dados: uma
empresa cliente do CRM. No código e no banco esse objeto é `Account`.

Uma conta pode ter várias caixas de entrada (`Inbox`). Cada conexão WhatsApp é
uma caixa e possui seu próprio `id`, nome, número/identificador e sessão. Uma
conversa pertence a uma conta e a uma caixa de entrada.

Isso produz dois níveis de configuração na tela de plataforma:

| Configuração      | Escopo                                   | Situação real atual               |
| ----------------- | ---------------------------------------- | --------------------------------- |
| Webhooks da conta | Conta inteira ou caixas selecionadas     | Funcional                         |
| Tokens de API     | Conta inteira                            | Funcional; não há token por caixa |

O antigo cartão **Webhook por caixa de entrada** foi retirado: ele gravava
`Inbox.webhookUrl`, que o despachante nunca leu. As caixas agora são escolhidas
dentro do próprio webhook da conta.

As integrações ficam em:

```text
/plataforma -> conta desejada -> aba Integrações
```

Essa área é protegida para o superadministrador da plataforma. Um administrador
comum dentro do workspace não configura esses itens atualmente.

## O que dispara quando chega uma mensagem

O CRM dispara o webhook nos dois sentidos: o que o contato manda e o que sai da
caixa — do atendente, do agente de IA ou do próprio celular pareado. Cada
mensagem gera exatamente um destes assuntos de inscrição:

| Assunto             | Quando                                                             |
| ------------------- | ------------------------------------------------------------------ |
| `conversa.criada`   | mensagem **recebida** que abriu uma conversa nova                  |
| `mensagem.recebida` | mensagem **recebida** numa conversa que já existia                 |
| `mensagem.enviada`  | qualquer mensagem que **sai** da caixa, inclusive a que o CRM mandou |

Para receber todas as entradas, assine `conversa.criada` **e**
`mensagem.recebida`. Assinar apenas o segundo faz o n8n perder a primeira
mensagem de toda conversa nova.

> **Assinar `mensagem.enviada` num fluxo que responde sozinho exige um filtro.**
> A resposta que o agente manda volta como evento, e sem uma condição na entrada
> ele passa a responder à própria resposta, em laço. Filtre no primeiro nó:
>
> ```text
> {{ $json.body.data.key.fromMe }}   // false = veio do contato
> ```

O nome do assunto vai no cabeçalho `X-Solint-Event`. Dentro do corpo, `event` é
sempre `messages.upsert`: o WhatsApp não distingue essas três situações, quem
distingue é a inscrição.

`conversa.resolvida` e `contato.criado` continuam no formulário por
compatibilidade com quem já os marcou, mas **nenhuma linha do código os emite**:
o único ponto de disparo é o caminho da mensagem.

### Horário de funcionamento do agente

Cada caixa pode limitar o agente de IA a um horário (Configurações › Caixas de
entrada › Agente de IA). Com o horário ligado, **uma mensagem fora dele não
dispara webhook nenhum daquela caixa**, em nenhum dos três assuntos: o n8n nem é
acordado, e ela também não chega à memória do agente. Quem julga é o horário da
mensagem, não o da entrega, então uma fila represada que chega depois continua
respeitando a grade.

É o oposto da pausa por conversa (`agentePausado`): pausado, o evento é entregue
e o fluxo decide não responder; fora do horário, o evento não existe. Com o
horário desligado, o agente atende a qualquer hora.

### Entrega e tolerância a falhas

O CRM grava cada entrega em uma outbox persistente e um runner faz o `POST` JSON,
esperando no máximo 5 segundos pela resposta do destino. As entregas de um mesmo
webhook são ordenadas e webhooks distintos podem avançar em paralelo.

A resposta do destino decide o que acontece com uma entrega que falhou:

- **Temporária** (5xx, 408, 425, 429, timeout ou erro de rede): repetida com
  backoff de 5 s dobrando a cada vez (5 s, 10 s, 20 s... até 320 s). Depois de 8
  tentativas, cerca de 11 minutos no total, a entrega fica registrada como
  `failed`.
- **Definitiva** (os demais 4xx, como 400, 404 e 413): registrada como `failed`
  na primeira resposta, sem repetir. Um fluxo do n8n desativado responde 404, e
  repeti-lo só seguraria as entregas seguintes do mesmo webhook.

Entregas concluídas ou canceladas são apagadas depois de 3 dias, e as que
falharam, depois de 14.

No Webhook node do n8n, use a resposta **imediata**. O agente de IA pode continuar
o workflow depois disso, sem manter o recebimento do CRM esperando pela geração
do texto.

O n8n também deve tratar `data.key.id` como chave de idempotência. O CRM deduplica
o evento recebido e a entrada da outbox, mas a entrega é intencionalmente
"pelo menos uma vez": se a resposta do n8n for perdida após ele processar o POST,
uma retentativa legítima pode ocorrer.

## Cabeçalhos enviados ao n8n

O webhook funcional da conta envia:

```http
Content-Type: application/json
User-Agent: Solint-CRM-Webhook/1
X-Solint-Event: mensagem.recebida
X-Solint-Signature: sha256=<hmac-em-hexadecimal>
```

`X-Solint-Signature` só existe quando um segredo foi informado ao criar o webhook.
O HMAC usa SHA-256, o segredo cadastrado e os bytes exatos do corpo JSON:

```ts
const esperado = `sha256=${createHmac('sha256', segredo).update(corpoBruto).digest('hex')}`;
```

O segredo do webhook e o token da API têm funções diferentes:

- **segredo do webhook:** permite ao n8n conferir que a entrada veio do CRM;
- **token da API:** permite ao n8n chamar o CRM para enviar a resposta.

O CRM não envia um Bearer token ao webhook do n8n. Caso o n8n exija autenticação
própria na URL, ela teria de estar incorporada à URL ou ser suportada futuramente
como cabeçalho configurável. A autenticação nativa disponível hoje é a assinatura
HMAC opcional.

## JSON enviado pelo CRM

O corpo entregue é a **mensagem crua do WhatsApp**, como o protocolo a entrega —
não uma tradução para o vocabulário do CRM. É o que faz áudio, resposta citada,
figurinha, localização e anúncio chegarem inteiros, sem depender de o CRM ter
previsto cada tipo.

Uma mensagem de texto numa conversa já existente:

```json
{
  "event": "messages.upsert",
  "instance": "Comercial RJ",
  "data": {
    "key": {
      "remoteJid": "5521999620011@s.whatsapp.net",
      "remoteJidAlt": "5521999620011@s.whatsapp.net",
      "fromMe": false,
      "id": "3EB0ABC123",
      "participant": "",
      "addressingMode": "lid"
    },
    "pushName": "Maria da Silva",
    "status": "DELIVERY_ACK",
    "message": {
      "conversation": "Gostaria de saber mais sobre o serviço."
    },
    "contextInfo": null,
    "messageType": "conversation",
    "messageTimestamp": 1787410667,
    "instanceId": "ibx-comercial-rj",
    "source": "android"
  },
  "destination": "https://n8n.seudominio.com/webhook/solint/agente-comercial",
  "date_time": "2026-09-03T14:20:31.421Z",
  "sender": "5521988887777@s.whatsapp.net",
  "solint": {
    "contaId": "acc-solint",
    "caixaEntradaId": "ibx-comercial-rj",
    "conversaId": "cv-wa-ibx-comercial-rj-5521999620011",
    "contatoId": "ct-wa-acc-solint-5521999620011",
    "mensagemId": "msg-wa-cv-wa-ibx-comercial-rj-5521999620011-3EB0ABC123",
    "conversaNova": false
  }
}
```

Numa conversa nova, a única diferença é `solint.conversaNova: true` — e o
cabeçalho `X-Solint-Event`, que traz `conversa.criada` em vez de
`mensagem.recebida`. A estrutura é a mesma.

**Nenhum campo binário sai daqui.** Miniaturas, chaves de mídia, hashes e o
`messageContextInfo` são removidos antes da entrega. Era o que enchia o corpo de
blocos como `{"0":80,"1":180,...}` com centenas de entradas. A remoção é por
forma, não por lista de nomes: campo binário novo que o WhatsApp inventar já sai
descartado.

### Campos do payload

| Campo                   | Uso no workflow                                                        |
| ----------------------- | ---------------------------------------------------------------------- |
| `event`                 | Sempre `messages.upsert`                                               |
| `instance`              | Nome da caixa de entrada — use no Switch quando houver várias          |
| `data.key.remoteJid`    | Chat de origem; é o destinatário ao responder                          |
| `data.key.fromMe`       | `false` = veio do contato, `true` = saiu daqui                         |
| `data.key.id`           | Id da mensagem no WhatsApp; chave de deduplicação                      |
| `data.pushName`         | Nome que o contato exibe no WhatsApp                                   |
| `data.status`           | `PENDING`, `SERVER_ACK`, `DELIVERY_ACK`, `READ`, `PLAYED`              |
| `data.message`          | Conteúdo cru: `conversation`, `audioMessage`, `imageMessage`, ...      |
| `data.messageType`      | Nome da chave presente em `data.message`                               |
| `data.contextInfo`      | Citação, menções e anúncio de origem, elevados do conteúdo             |
| `data.messageTimestamp` | Segundos, como o WhatsApp envia                                        |
| `data.instanceId`       | Id da caixa; é o valor estável para filtrar                            |
| `data.source`           | `android`, `ios`, `web`, `desktop` ou `unknown`                        |
| `data.mediaUrl`         | Só quando a mídia passou do teto do base64 (ver abaixo)                |
| `destination`           | A URL deste cadastro — distingue qual webhook chamou                   |
| `date_time`             | Instante da entrega, em ISO                                            |
| `sender`                | JID do número conectado na caixa                                       |
| `solint.*`              | Ids do CRM para a resposta (ver adiante)                               |

O texto da mensagem está em `data.message.conversation` **ou** em
`data.message.extendedTextMessage.text` — a segunda forma é a que o WhatsApp usa
quando há citação, menção ou clique em anúncio. A expressão que cobre as duas:

```text
{{ $json.body.data.message.conversation || $json.body.data.message.extendedTextMessage?.text }}
```

### Mídia: áudio, imagem, vídeo, documento

Os bytes vêm **decifrados e em base64**, dentro do próprio corpo, em
`data.message.base64`. Não é preciso um nó de download:

```json
{
  "data": {
    "messageType": "audioMessage",
    "message": {
      "audioMessage": {
        "mimetype": "audio/ogg; codecs=opus",
        "fileLength": "6789",
        "seconds": 7,
        "ptt": true
      },
      "base64": "T2dnUwACAAAAAAAAAAA..."
    }
  }
}
```

`ptt: true` distingue o áudio gravado na hora do arquivo de áudio anexado — é a
diferença entre "transcrever" e "tratar como anexo".

O teto padrão é **5 MB de arquivo** (≈6,7 MB de corpo, porque base64 cresce
~4/3). Ele existe porque a entrega tem prazo de 5 segundos: um anexo grande
estouraria o prazo e derrubaria a entrega inteira, texto incluído. Ajuste em
`WEBHOOK_MEDIA_BASE64_MAX_BYTES`.

Acima do teto o `base64` não vai e entra `data.mediaUrl`, absoluta, que exige o
token da conta:

```http
GET https://crm.seudominio.com/api/whatsapp/media/3EB0ABC123
Authorization: Bearer sk_live_SEU_TOKEN
```

`data.mediaUrl` só é montada quando a variável `SOLINT_APP_URL` está configurada
— sem ela o CRM não tem como saber o próprio endereço público. O acesso é
validado contra a conta do token: mídia de outra conta responde como não
encontrada.

> A mensagem que o **próprio CRM** envia (`fromMe: true` vindo daqui) não carrega
> base64: são bytes que o servidor acabou de subir para o WhatsApp, e baixá-los
> de volta pagaria o mesmo tráfego duas vezes. `data.mediaUrl` cobre quem
> precisar deles.

### Resposta a uma mensagem (citação)

```json
{
  "data": {
    "messageType": "extendedTextMessage",
    "contextInfo": {
      "stanzaId": "3EB0C767D097C1E1A5D2",
      "participant": "5521999620011@s.whatsapp.net",
      "quotedMessage": { "conversation": "Você quer dizer o plano anual?" }
    }
  }
}
```

`stanzaId` é o `data.key.id` da mensagem citada — é por ele que se reencontra a
original. O mesmo bloco também está no lugar de origem, dentro de
`data.message.extendedTextMessage.contextInfo`.

### Anúncio Click-to-WhatsApp

Quando a conversa nasceu de um clique em anúncio do Instagram ou do Facebook:

```json
{
  "data": {
    "contextInfo": {
      "conversionSource": "FB_Ads",
      "conversionDelaySeconds": 22,
      "externalAdReply": {
        "title": "Campanha de setembro",
        "body": "Conheça o plano empresarial...",
        "mediaType": 2,
        "thumbnailUrl": "https://instagram.fxxx.fna.fbcdn.net/v/...",
        "sourceUrl": "https://www.facebook.com/suapagina/videos/1",
        "ctwaClid": "AfjnxCbUfFNQ3rA2xbXIP6ql4CkSnGA5EbP4U9YK"
      }
    }
  }
}
```

É o que permite o agente já responder sobre o produto que a pessoa estava
olhando, em vez de abrir perguntando. `ctwaClid` identifica o clique e serve para
casar a conversa com a campanha no relatório de anúncios. A miniatura em bytes é
removida; `thumbnailUrl` continua e aponta para a imagem.

O bloco só aparece na mensagem que trouxe o contexto — normalmente a primeira.

## Como configurar o webhook no n8n

### 1. Criar o endpoint no n8n

Crie um workflow e adicione um **Webhook** node:

- método: `POST`;
- caminho: por exemplo, `solint/agente-comercial`;
- resposta: imediata;
- workflow: ativo;
- use a URL de produção do node, não a URL de teste.

Em uma execução típica, o Webhook node do n8n coloca o corpo recebido em
`$json.body`. Assim, as expressões tendem a ser:

```text
{{$json.body.instance}}
{{$json.body.data.instanceId}}
{{$json.body.data.key.remoteJid}}
{{$json.body.data.key.id}}
{{$json.body.data.key.fromMe}}
{{$json.body.data.message.conversation}}
{{$json.body.solint.conversaId}}
```

Confirme a estrutura na primeira execução, pois configurações ou versões do node
podem entregar diretamente o corpo em `$json`, sem a propriedade `body`.

### 2. Cadastrar o webhook funcional no CRM

Na plataforma:

1. Abra a conta desejada.
2. Entre na aba **Integrações**.
3. No cartão **Webhooks da conta**, informe nome e URL de produção do n8n.
4. Marque **Mensagem recebida** e **Conversa criada**. Marque **Mensagem
   enviada** apenas se o fluxo precisar ver o que sai — e, nesse caso, filtre
   `data.key.fromMe` na entrada.
5. Informe um segredo de assinatura com pelo menos 16 caracteres.
6. Adicione o webhook e mantenha-o ativo.

No mesmo cadastro, escolha as **caixas autorizadas**:

- **Todas as caixas, inclusive futuras** — o webhook recebe de qualquer conexão
  da conta, e passa a receber das que forem criadas depois.
- **Somente as selecionadas** — marque as caixas na lista. O webhook novo começa
  nesta opção, e exige pelo menos uma marcada.

A seleção pode ser alterada depois, sem excluir o webhook, em **Configurar caixas
autorizadas**. Restringir o escopo cancela as entregas que ainda estavam na fila
para as caixas removidas; uma requisição já em andamento naquele instante chega ao
destino mesmo assim.

Uma caixa desconectada e ainda marcada volta a disparar sozinha quando reconectar.
Se a última caixa selecionada for excluída, o webhook é desativado — sem caixa
nenhuma ele não teria de onde receber, e ficar ativo esconderia isso.

### 3. Filtrar a caixa desejada

**Não é mais necessário.** A seleção de caixas no cadastro do webhook faz esse
trabalho no servidor: um webhook restrito à caixa A não gera entrega, requisição
nem execução quando a mensagem vem da caixa B.

O filtro por `data.instanceId` continua funcionando e ainda vale em dois casos:

- um único webhook que atende várias caixas e precisa **direcionar** cada uma a um
  agente, prompt ou workflow diferente (use um **Switch**);
- defesa em profundidade, enquanto o fluxo antigo estiver sendo migrado.

```text
{{$json.body.data.instanceId}}
```

`instance` traz o nome legível da mesma caixa, mas ele muda se alguém renomear a
conexão — para decidir, prefira o id.

Se o webhook assina `mensagem.enviada`, o eco continua sendo problema seu: o
escopo por caixa não distingue quem mandou a mensagem.

```text
{{ $json.body.data.key.fromMe }} === false
```

### 4. Impedir respostas duplicadas

Antes do agente, consulte um Data Store ou banco usando `data.key.id` como chave.
Se a chave já tiver sido processada, encerre a execução. Se não tiver, registre-a
e continue.

Uma política segura é gravar também:

- `solint.contaId`;
- `data.instanceId`;
- `solint.conversaId`;
- `data.key.id`;
- estado `recebida`, `processando`, `respondida` ou `erro`;
- `mensagemId` devolvido pelo POST de resposta.

### 5. Dar memória ao agente

O webhook entrega a mensagem atual e dados do contato, mas não entrega o histórico
completo. Também não existe hoje uma rota pública `GET` para buscar a conversa.

Para um agente contextual, mantenha memória no n8n ou em um banco externo usando
`solint.conversaId` (ou `data.key.remoteJid`) como Session Key. Grave
separadamente o texto do contato e a resposta final do agente.

## Gerar o token de API

Na mesma aba **Integrações**, no cartão **Tokens de API**:

1. Dê um nome descritivo, como `Agente IA n8n - Comercial RJ`.
2. Clique em **Gerar token**.
3. Copie imediatamente o valor `sk_live_...`.
4. Guarde-o como credencial/secret do n8n, nunca dentro do workflow em texto aberto.

O segredo em claro aparece uma única vez. O banco conserva apenas o SHA-256; se o
valor for perdido, é necessário revogar e gerar outro.

### Escopo real do token

O token pertence à conta inteira. Ele não é gerado automaticamente e não fica
limitado à caixa cujo nome foi usado no cadastro. A sessão criada pelo token tem
acesso a todas as caixas da conta. O `conversaId` informado no POST é que seleciona
a conversa e, por consequência, a conexão correta.

É possível criar um token separado por agente ou por conexão para facilitar a
revogação e a auditoria, mas isso é apenas separação operacional: todos continuam
com escopo técnico de conta. A interface atual gera tokens com permissões `*` e
sem data de expiração. Eles permanecem válidos até serem revogados.

## Como sinalizar que o agente está digitando

Adicione um **HTTP Request** no caminho que vai executar o agente, antes do node
**AI Agent**. Colocá-lo somente depois que o modelo terminou faria o indicador
aparecer por pouco tempo ou até chegar depois da mensagem no motor worker.

- método: `POST`;
- URL: `https://crm.seudominio.com/api/v1/presenca`;
- autenticação: a mesma credencial Bearer usada pela rota de mensagens;
- header `Content-Type`: `application/json`;
- timeout recomendado: 10 segundos;
- em caso de erro: continuar o workflow, porque presença é um efeito visual e
  não deve impedir a resposta.

No workflow de exemplo, use:

```json
{
  "conversaId": "={{ $('Preparar evento do CRM').item.json.conversaId }}",
  "status": "composing"
}
```

A rota também aceita `jid`, ou `number` com `instanceId`, seguindo exatamente as
mesmas regras de resolução de destinatário da rota de mensagens. Os estados são:

| `status`    | Efeito no WhatsApp |
| ----------- | ------------------- |
| `composing` | Digitando           |
| `paused`    | Parou de digitar    |
| `recording` | Gravando áudio      |

O padrão é `composing`. Enviar a mensagem normalmente encerra o indicador; um
POST adicional com `paused` só é útil num caminho em que a geração foi cancelada.

### Quanto tempo o indicador fica visível

Isso não é um parâmetro do protocolo do WhatsApp: uma chamada de presença é um
aviso pontual, e o aparelho do destinatário decide sozinho quando parar de
mostrá-lo se nada renovar o aviso. Duas formas de lidar com isso:

**Chamar antes do agente, sem duração.** É o padrão acima. A rota responde
imediatamente e a sessão sustenta o indicador por seis segundos em background,
sem bloquear a fila da caixa. Uma chamada nova renova apenas o relógio daquele
chat; presenças de outras conversas e de outras caixas continuam independentes.

**Informar `duracaoMs`, chamando depois que o texto já existe.** Quem migra de
um fluxo que usava o campo `delay` da Evolution API tinha esse formato:

```json
{
  "number": "={{ $('Preparar evento do CRM').item.json.data.key.remoteJid }}",
  "delay": "={{ Math.min(Math.max($('AI Agent').item.json.output.length * 60, 1000), 6000) }}",
  "presence": "composing"
}
```

O equivalente aqui:

```json
{
  "jid": "={{ $('Preparar evento do CRM').item.json.data.key.remoteJid }}",
  "status": "composing",
  "duracaoMs": "={{ Math.min(Math.max($('AI Agent').item.json.output.length * 60, 1000), 6000) }}"
}
```

Com `duracaoMs`, a rota mantém a requisição do n8n presa por esse tempo — o
indicador fica visível durante a espera — e manda `paused` sozinha antes de
responder. **O teto é 6 segundos.** Não é um número arbitrário: sem
`maxDuration` configurado na função que atende esta rota, a hospedagem aplica um
limite de execução (em torno de dez segundos em planos comuns), e prender a
chamada além disso arrisca a própria requisição de presença estourar por
timeout — o oposto do que ela deveria garantir. Um valor maior que o teto é
recusado com `400`, não truncado em silêncio.

Se a resposta do agente for tipicamente longa e a fórmula acima passar de 6s com
frequência, prefira o primeiro padrão (chamar antes do agente, sem duração): o
tempo de geração ali não compete com o limite da função.

Resposta no motor worker:

```json
{
  "ok": true,
  "conversaId": "cv-...",
  "status": "composing",
  "aceito": true,
  "enfileirado": true,
  "confirmadoPeloWorker": true,
  "duracaoMs": 3200
}
```

`duracaoMs` só volta no corpo quando foi informado na chamada. `aceito` confirma
o despacho pelo CRM, e `confirmadoPeloWorker` diz se o worker chegou a executar
o comando dentro da espera curta da rota. Nenhum dos dois pode provar que o
aparelho remoto desenhou o indicador. A presença é efêmera e não cria mensagem
nem item na timeline.

Antes de enviar uma resposta de agente por `POST /api/v1/mensagens`, o CRM
enfileira a confirmação de leitura na mesma caixa. Comandos inequívocos do contato
como `PARAR`, `STOP` ou `NÃO QUERO RECEBER MENSAGENS` bloqueiam respostas
automáticas e manuais até um novo opt-in (`VOLTAR`, `START`, `REATIVAR` ou
equivalente aceito). Pedidos como `HUMANO` ou `FALAR COM ATENDENTE` pausam o
agente, mas continuam visíveis no webhook para o atendimento humano.

## Como enviar a resposta do agente

Adicione um **HTTP Request** node depois do agente:

- método: `POST`;
- URL: `https://crm.seudominio.com/api/v1/mensagens`;
- header `Authorization`: `Bearer sk_live_SEU_TOKEN`;
- header `Content-Type`: `application/json`;
- corpo: JSON.

A rota aceita **três formas de dizer para quem** é a resposta. Use a que for
mais natural ao fluxo:

```json
{
  "jid": "5521999620011@s.whatsapp.net",
  "texto": "Olá! Posso ajudar com as informações do plano empresarial."
}
```

```json
{
  "number": "5521999620011",
  "instanceId": "ibx-comercial-rj",
  "texto": "..."
}
```

```json
{
  "conversaId": "cv-wa-ibx-comercial-rj-5521999620011",
  "texto": "..."
}
```

`jid` e `number` existem para que o nó de resposta trabalhe com os mesmos campos
que o corpo recebido já traz, sem carregar o bloco `solint` até o fim do fluxo.
`instanceId` é opcional e desempata quando a mesma conta tem duas caixas falando
com o mesmo número — sem ele vale a conversa de atividade mais recente.

O nono dígito não atrapalha: `5521999620011` e `552199620011` encontram a mesma
conversa.

Exemplo conceitual com expressões do n8n:

```json
{
  "jid": "={{ $('Webhook').item.json.body.data.key.remoteJid }}",
  "instanceId": "={{ $('Webhook').item.json.body.data.instanceId }}",
  "texto": "={{ $json.output }}"
}
```

O nome do node e o campo de saída do agente (`output` no exemplo) devem ser
ajustados ao workflow real.

`notaInterna` é opcional e o padrão é `false`. Não envie `true` para a resposta do
agente, pois nesse caso o texto vira uma nota interna e não sai para o WhatsApp:

```json
{
  "conversaId": "...",
  "texto": "Registro interno",
  "notaInterna": true
}
```

A API aceita atualmente apenas texto. Ela não expõe por essa rota envio de imagem,
áudio, documento, template ou uma resposta citando outra mensagem.

### A conversa precisa existir

Seja qual for a forma usada, a rota **encontra** uma conversa; ela não abre uma.
Um `jid` sem conversa nesta conta responde `404`. O envio é a resposta a um
atendimento que já começou.

A conversa encontrada já contém `inboxId`, `channelThreadId` e contato, então a
resposta sai pela mesma caixa que recebeu a mensagem, inclusive em grupos.

Quando a mesma pessoa tem conversa em duas caixas, o telefone sozinho não
determina a conexão: informe `instanceId` junto (o `data.instanceId` do corpo
recebido) ou use `solint.conversaId`, que não tem ambiguidade.

## Respostas da API

Envio confirmado pelo canal:

```json
{
  "ok": true,
  "mensagemId": "cm123...",
  "externalId": "3EB0DEF456",
  "entregue": true
}
```

Envio aceito pela fila do worker:

```json
{
  "ok": true,
  "mensagemId": "cm123...",
  "entregue": false,
  "enfileirado": true
}
```

Nesse segundo caso, o worker aceitou o comando, mas o envio ainda não foi
confirmado. Não repita o POST: isso criaria outra mensagem.

Principais status HTTP:

| Status | Significado                                                   |
| ------ | ------------------------------------------------------------- |
| `200`  | Mensagem enviada, aceita na fila ou nota interna gravada      |
| `400`  | JSON inválido, texto vazio/maior que 4096 ou payload inválido |
| `401`  | Bearer token ausente, inválido ou expirado                    |
| `403`  | Token sem permissão de responder                              |
| `404`  | Conversa não existe dentro da conta do token                  |
| `409`  | Janela de texto livre fechada; previsto pela API              |
| `502`  | Falha ao despachar para o canal                               |
| `503`  | Conexão WhatsApp desconectada                                 |

No WhatsApp Direto atual, conectado por Baileys/QR Code, a validação da janela de
24 horas retorna aberta, portanto o `409` não deve ocorrer nesse canal hoje.

O registro da mensagem é criado antes da tentativa de envio ao WhatsApp. Por isso,
respostas `502` e `503` podem incluir `mensagemId` e já existir na timeline. A rota
aceita o cabeçalho opcional `Idempotency-Key` (até 128 caracteres). O n8n deve
enviar uma chave estável por resposta, preferencialmente derivada do ID da mensagem
recebida. Repetir a mesma requisição devolve a mensagem já criada; reutilizar a
mesma chave com outro conteúdo ou destino retorna `409`.

## Segurança recomendada

1. Use HTTPS no CRM e no n8n.
2. Configure um segredo HMAC no webhook da conta.
3. Guarde o Bearer token no Credentials/Secrets do n8n.
4. Use um token dedicado para o workflow, facilitando sua revogação.
5. Nunca inclua o token em query string, logs, prompts ou saída do agente.
6. Deduplicate entradas por `data.key.id`.
7. Selecione as caixas autorizadas no cadastro do webhook. Conferir
   `solint.contaId` no fluxo continua sendo uma segunda barreira barata.
8. Limite o texto final a 4096 caracteres.
9. Trate a saída do modelo como dado: não deixe o agente escolher URL, token,
   destinatário (`jid`, `number`, `conversaId`) ou headers do HTTP Request.
10. Se baixar mídia, reutilize o Bearer token apenas contra o domínio do CRM.

## Limitações encontradas e melhorias indicadas

### 1. Escopo por caixa de entrada — resolvido

O despachante consulta a tabela `Webhook` filtrando por conta, por evento **e por
caixa**: `allInboxes = true`, ou um vínculo em `WebhookInbox` com a caixa que
originou o evento. Um evento sem caixa (o que não nasceu de uma conversa) só
alcança quem vale para todas.

A coluna `Inbox.webhookUrl`, da tela antiga, continua no banco por uma versão para
permitir rollback, mas nada a lê. Ela **não** foi migrada automaticamente: ligar
URLs que nunca dispararam mandaria dados para endereços que ninguém conferiu.

### 2. A primeira mensagem usa outro assunto de inscrição

Uma conversa nova emite `conversa.criada`, não `mensagem.recebida`. No corpo isso
não muda nada — `event` é `messages.upsert` nos dois casos e `solint.conversaNova`
diz qual é qual — mas a **inscrição** é separada.

Enquanto isso, assine os dois.

### 3. Dois eventos oferecidos não possuem disparo

`conversa.resolvida` e `contato.criado` aparecem no formulário, mas não possuem
chamadas de emissão no código. Os equivalentes no vocabulário do WhatsApp seriam
`chats.update` e `contacts.upsert`.

### 4. Token não possui escopo por caixa

Mesmo criando um token com o nome de uma conexão, ele recebe acesso a todas as
caixas da conta. Uma futura evolução pode adicionar `inboxIds` permitidos ao token
e validar o `conversation.inboxId` na API.

### 5. Entrega de webhook com fila e retentativa — resolvido

A entrega agora usa outbox persistente, tentativas com backoff, lease, ordenação
por webhook, deduplicação e histórico de resultado. Eventos que esgotam as 8
tentativas ficam como `dead` para inspeção operacional.

### 6. API de resposta com idempotência — resolvido

Envie `Idempotency-Key` no HTTP Request do n8n. A chave é vinculada à conta e ao
payload da resposta, evitando outro registro quando um resultado ficou incerto.

### 7. Não há endpoint público de histórico

O agente recebe só a entrada atual. Hoje sua memória precisa morar no n8n ou em
outro banco. Uma API de leitura de conversa permitiria reconstruir contexto com as
mesmas regras de isolamento da conta e da caixa.

## Checklist de ativação

- [ ] Webhook node do n8n usa URL de produção e resposta imediata.
- [ ] Webhook da **conta** está ativo.
- [ ] Eventos `conversa.criada` e `mensagem.recebida` estão selecionados.
- [ ] Se `mensagem.enviada` está marcado, o fluxo filtra `data.key.fromMe`.
- [ ] Segredo HMAC foi configurado e armazenado com segurança.
- [ ] As caixas autorizadas foram marcadas no cadastro do webhook.
- [ ] Se um webhook atende várias caixas, o fluxo direciona por `data.instanceId`.
- [ ] `data.key.id` é deduplicado antes do agente.
- [ ] A memória do agente usa `solint.conversaId` como chave.
- [ ] Token `sk_live_...` da conta foi gerado e salvo nas credenciais do n8n.
- [ ] HTTP Request chama `/api/v1/presenca` antes do agente e continua em caso de erro.
- [ ] HTTP Request chama `/api/v1/mensagens` com Bearer token.
- [ ] O destinatário vem do webhook, não do texto produzido pelo modelo.
- [ ] `SOLINT_APP_URL` está definida se a operação recebe mídia acima de 5 MB.
- [ ] Respostas enfileiradas não são reenviadas.
- [ ] Erros `502`/`503` geram alerta e não retentativa cega.

## Referências no código

- Payload, assinatura, timeout e consulta de webhooks da conta:
  `src/infrastructure/webhooks/webhook-dispatch.ts`
- Ponto real de disparo ao receber WhatsApp:
  `src/infrastructure/whatsapp/wa-store.ts`
- Rota de resposta do n8n:
  `src/app/api/v1/mensagens/route.ts`
- Rota de presença do n8n:
  `src/app/api/v1/presenca/route.ts`
- Resolução compartilhada de `conversaId`, `jid` e `number`:
  `src/app/api/v1/_shared/conversation-target.ts`
- Autenticação e escopo do token:
  `src/infrastructure/auth/api-token.ts`
- Criação e armazenamento dos tokens:
  `src/infrastructure/repositories/prisma/settings-repository.ts`
- Download autenticado de mídia:
  `src/app/api/whatsapp/media/[id]/route.ts`
- Telas de integração da plataforma:
  `src/features/plataforma/components/account-webhooks-card.tsx`,
  `src/features/plataforma/components/account-inbox-webhooks-card.tsx` e
  `src/features/plataforma/components/account-api-tokens-card.tsx`
