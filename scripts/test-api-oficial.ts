/**
 * API oficial do WhatsApp: as partes puras.
 *
 * Tranca o que não depende de banco nem da Meta:
 *  - assinatura do webhook (`X-Hub-Signature-256`);
 *  - separação do corpo em eventos, com deduplicação e ordem por contato;
 *  - tradução das mensagens da Meta para o CRM e para o corpo do n8n;
 *  - destinatário do envio (telefone, BSUID, grupo recusado);
 *  - janela de 24 h por provedor;
 *  - tradução dos erros da Graph API.
 *
 *   npx tsx scripts/test-api-oficial.ts
 */
import { createHmac } from 'node:crypto';

import { isHsmWindowOpen } from '../src/core/domain/conversation';
import { capabilitiesOf, isCustomerServiceWindowOpen } from '../src/core/domain/whatsapp-provider';
import {
  deliveryStatusFromCloud,
  translateCloudMessage,
} from '../src/infrastructure/whatsapp/cloud/cloud-inbound';
import { recipientOf } from '../src/infrastructure/whatsapp/cloud/cloud-sender';
import { buildCloudUpsertPayload } from '../src/infrastructure/whatsapp/cloud/cloud-webhook-payload';
import {
  isValidMetaSignature,
  splitCloudWebhook,
} from '../src/infrastructure/whatsapp/cloud/cloud-webhook-parse';
import {
  cloudApiErrorFrom,
  redactSecrets,
} from '../src/infrastructure/whatsapp/cloud/graph-client';

const falhas: string[] = [];
const check = (label: string, ok: boolean, detalhe = '') => {
  console.log(`  ${ok ? 'OK   ' : 'FALHA'} ${label}${detalhe ? ` (${detalhe})` : ''}`);
  if (!ok) falhas.push(label);
};

console.log('\n1) Assinatura do webhook');
const secret = '0123456789abcdef0123456789abcdef';
const corpo = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
const assinatura = `sha256=${createHmac('sha256', secret).update(corpo).digest('hex')}`;
check('assinatura correta passa', isValidMetaSignature(corpo, assinatura, secret));
check('um byte a mais no corpo falha', !isValidMetaSignature(`${corpo} `, assinatura, secret));
check('header ausente falha', !isValidMetaSignature(corpo, null, secret));
check(
  'prefixo errado falha',
  !isValidMetaSignature(corpo, assinatura.replace('sha256', 'sha1'), secret),
);
check('secret errado falha', !isValidMetaSignature(corpo, assinatura, 'outro'));

console.log('\n2) Separação dos eventos');
const webhook = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA1',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '5511900000000', phone_number_id: 'PN1' },
            contacts: [
              { profile: { name: 'Maria' }, wa_id: '557999998888', user_id: 'BR.111' },
              { profile: { name: 'João' }, wa_id: '557988887777', user_id: 'BR.222' },
            ],
            messages: [
              {
                from: '557999998888',
                from_user_id: 'BR.111',
                id: 'wamid.A',
                timestamp: '1758100000',
                type: 'text',
                text: { body: 'oi' },
              },
              {
                from: '557988887777',
                from_user_id: 'BR.222',
                id: 'wamid.B',
                timestamp: '1758100001',
                type: 'image',
                image: { id: 'MEDIA1', mime_type: 'image/jpeg', caption: 'nota' },
              },
            ],
            statuses: [{ id: 'wamid.C', status: 'delivered', recipient_id: '557999998888' }],
          },
        },
        {
          field: 'message_template_status_update',
          value: {
            event: 'APPROVED',
            message_template_id: 123,
            message_template_name: 'boas_vindas',
            message_template_language: 'pt_BR',
          },
        },
      ],
    },
  ],
};
const eventos = splitCloudWebhook(webhook);
check(
  'quatro eventos (2 mensagens, 1 status, 1 template)',
  eventos.length === 4,
  `${eventos.length}`,
);
const mensagemB = eventos.find((e) => e.dedupeKey === 'message:wamid.B');
check(
  'cada mensagem leva o próprio contato',
  (mensagemB?.payload['contact'] as { user_id?: string })?.user_id === 'BR.222',
);
check('ordem por contato', mensagemB?.orderKey === 'PN1:BR.222', mensagemB?.orderKey);
check(
  'status deduplica por id e estado',
  eventos.some((e) => e.dedupeKey === 'status:wamid.C:delivered'),
);
const template = eventos.find((e) => e.kind === 'template_status');
check(
  'evento da conta inteira é roteado pela WABA',
  template?.phoneNumberId === 'waba:WABA1',
  template?.phoneNumberId,
);
check(
  'objeto de outra origem é ignorado',
  splitCloudWebhook({ object: 'page', entry: [] }).length === 0,
);

console.log('\n3) Tradução das mensagens');
const texto = translateCloudMessage(
  {
    from: '557999998888',
    from_user_id: 'BR.111',
    id: 'wamid.A',
    timestamp: '1758100000',
    type: 'text',
    text: { body: 'oi' },
    context: { id: 'wamid.X' },
  },
  { fromMe: false, contact: { profile: { name: 'Maria' }, wa_id: '557999998888' } },
);
check('texto vira texto', texto?.content.type === 'text' && texto.preview === 'oi');
check('telefone em E.164', texto?.phone === '+557999998888', texto?.phone);
check('nome do perfil', texto?.profileName === 'Maria');
check('citação preservada', texto?.quotedWamid === 'wamid.X');

const audio = translateCloudMessage(
  {
    from: '557999998888',
    id: 'wamid.D',
    type: 'audio',
    audio: { id: 'M2', mime_type: 'audio/ogg; codecs=opus', voice: true },
  },
  { fromMe: false },
);
check(
  'áudio de voz com mídia a baixar',
  audio?.media?.kind === 'audio' && audio.media.voice === true && audio.preview === '🎤 Áudio',
);

const soBsuid = translateCloudMessage(
  { from_user_id: 'BR.999', id: 'wamid.E', type: 'text', text: { body: 'olá' } },
  { fromMe: false },
);
check(
  'cliente só com BSUID não tem telefone',
  soBsuid?.phone === '' && soBsuid.userId === 'BR.999',
);

const reacao = translateCloudMessage(
  {
    from: '557999998888',
    id: 'wamid.F',
    type: 'reaction',
    reaction: { message_id: 'wamid.A', emoji: '👍' },
  },
  { fromMe: false },
);
check(
  'reação aponta a mensagem reagida',
  reacao?.reaction?.targetWamid === 'wamid.A' && reacao.reaction.emoji === '👍',
);

const eco = translateCloudMessage(
  {
    from: '5511900000000',
    to: '557999998888',
    id: 'wamid.G',
    type: 'text',
    text: { body: 'respondi pelo app' },
  },
  { fromMe: true },
);
check(
  'eco da coexistência usa o destinatário',
  eco?.fromMe === true && eco.phone === '+557999998888',
);

const naoSuportada = translateCloudMessage(
  { from: '557999998888', id: 'wamid.H', type: 'unsupported' },
  { fromMe: false },
);
check(
  'tipo não suportado vira aviso, não some',
  Boolean(naoSuportada?.preview.includes('não suportada')),
);

check(
  'status da Meta',
  deliveryStatusFromCloud('read') === 'lido' && deliveryStatusFromCloud('failed') === 'falha',
);

console.log('\n4) Corpo para o n8n no formato do QR Code');
if (texto) {
  const payload = buildCloudUpsertPayload({
    msg: texto,
    raw: { id: 'wamid.A', type: 'text', text: { body: 'oi' } },
    instance: 'Caixa oficial',
    instanceId: 'ibx-1',
    businessPhone: '+5511900000000',
    solint: {
      contaId: 'acc',
      caixaEntradaId: 'ibx-1',
      conversaId: 'cv',
      contatoId: 'ct',
      mensagemId: 'm',
      conversaNova: false,
    },
  });
  check('remoteJid do contato', payload.data.key['remoteJid'] === '557999998888@s.whatsapp.net');
  check('citação vira extendedTextMessage', payload.data.messageType === 'extendedTextMessage');
  check('source marca a API oficial', payload.data.source === 'cloud_api');
  check('sender é o número da caixa', payload.sender === '5511900000000@s.whatsapp.net');
}

console.log('\n5) Destinatário do envio');
check(
  'telefone vai em `to`',
  JSON.stringify(recipientOf({ phone: '+55 79 99999-8888' })) === '{"to":"5579999998888"}',
);
check(
  'jid vira dígitos',
  JSON.stringify(recipientOf({ channelThreadId: '557999998888@s.whatsapp.net' })) ===
    '{"to":"557999998888"}',
);
check(
  'BSUID vai em `recipient`',
  JSON.stringify(recipientOf({ channelThreadId: 'bsuid:BR.999' })) === '{"recipient":"BR.999"}',
);
let grupoRecusado = false;
try {
  recipientOf({ channelThreadId: '123-456@g.us' });
} catch {
  grupoRecusado = true;
}
check('grupo é recusado com mensagem clara', grupoRecusado);

console.log('\n6) Janela de 24 h por provedor');
const agora = new Date('2026-09-17T12:00:00Z');
const base = { channel: 'whatsapp' as const };
check(
  'QR Code não tem janela',
  isHsmWindowOpen({ ...base, lastInboundAt: '2026-09-01T00:00:00Z' }, agora),
);
check(
  'API oficial aberta com 23h59',
  isHsmWindowOpen(
    { ...base, channelProvider: 'cloud_api', lastInboundAt: '2026-09-16T12:01:00Z' },
    agora,
  ),
);
check(
  'API oficial fechada com 24h01',
  !isHsmWindowOpen(
    { ...base, channelProvider: 'cloud_api', lastInboundAt: '2026-09-16T11:59:00Z' },
    agora,
  ),
);
check('sem mensagem do cliente não há janela', !isCustomerServiceWindowOpen(undefined, agora));
check('API oficial não apaga para todos', !capabilitiesOf('cloud_api').deleteForEveryone);

console.log('\n7) Erros da Graph API');
const janela = cloudApiErrorFrom(400, {
  error: { code: 131047, message: 'Re-engagement message' },
});
check(
  '131047 em português e não retentável',
  janela.message.includes('24 h') && !janela.retentavel,
);
const rajada = cloudApiErrorFrom(400, { error: { code: 131056 } });
check('131056 é retentável', rajada.retentavel);
const token = cloudApiErrorFrom(401, { error: { code: 190 } });
check('190 marca token inválido', token.tokenInvalido);
check(
  'token some do texto',
  !redactSecrets('falhou com EAAGm0PX4ZCpsBAABCDEFGHIJKLMNOPQRSTUVWXYZ').includes('ABCDEFGHIJ'),
);

if (falhas.length > 0) {
  console.error(`\n${falhas.length} falha(s): ${falhas.join('; ')}`);
  process.exit(1);
}
console.log('\nTodos os testes da API oficial passaram.');
