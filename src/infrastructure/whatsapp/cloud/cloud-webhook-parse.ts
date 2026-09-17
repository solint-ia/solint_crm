import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A parte pura da entrada do webhook da Meta: autenticidade e separação.
 *
 * Nada aqui toca banco, Baileys ou Next. É o que a rota do webhook importa, e é
 * o que dá para testar byte a byte sem subir nada.
 */

/**
 * O corpo veio mesmo da Meta?
 *
 * `X-Hub-Signature-256` é o HMAC-SHA256 do corpo **cru** com o app secret. O
 * corpo precisa ser exatamente os bytes recebidos: `JSON.stringify` de um
 * objeto já interpretado muda espaços e escapes e nunca bate.
 */
export const isValidMetaSignature = (
  rawBody: string,
  header: string | null | undefined,
  appSecret: string,
): boolean => {
  if (!header || !appSecret) return false;
  const [algoritmo, recebido] = header.split('=', 2);
  if (algoritmo !== 'sha256' || !recebido || !/^[0-9a-f]{64}$/i.test(recebido)) return false;
  const esperado = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest();
  const obtido = Buffer.from(recebido, 'hex');
  return obtido.length === esperado.length && timingSafeEqual(obtido, esperado);
};

export type CloudEventKind =
  | 'message'
  | 'status'
  | 'echo'
  | 'history'
  | 'app_state_sync'
  | 'template_status'
  | 'account_update'
  | 'quality'
  | 'user_preferences'
  | 'desconhecido';

export interface SplitCloudEvent {
  /** `phone_number_id` do número, ou `waba:<id>` nos eventos que são da conta inteira. */
  readonly phoneNumberId: string;
  readonly wabaId: string;
  readonly kind: CloudEventKind;
  readonly dedupeKey: string;
  /** Mesma chave para eventos que precisam respeitar ordem (mesmo contato). */
  readonly orderKey?: string;
  readonly payload: Record<string, unknown>;
}

type Obj = Record<string, unknown>;
const isObj = (valor: unknown): valor is Obj =>
  Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
const arr = (valor: unknown): readonly unknown[] => (Array.isArray(valor) ? valor : []);
const str = (valor: unknown): string | undefined =>
  typeof valor === 'string' && valor ? valor : undefined;
const hashOf = (valor: unknown): string =>
  createHash('sha256').update(JSON.stringify(valor)).digest('hex').slice(0, 32);

/**
 * Parte o corpo do webhook em eventos independentes.
 *
 * A Meta agrupa: um POST pode trazer várias mensagens, de contatos diferentes,
 * e vários status. Guardar o corpo inteiro como um evento só faria uma mensagem
 * problemática travar as outras dez que vieram junto.
 */
export const splitCloudWebhook = (body: unknown): readonly SplitCloudEvent[] => {
  if (!isObj(body) || body['object'] !== 'whatsapp_business_account') return [];
  const eventos: SplitCloudEvent[] = [];

  for (const entry of arr(body['entry'])) {
    if (!isObj(entry)) continue;
    const wabaId = str(entry['id']) ?? '';

    for (const change of arr(entry['changes'])) {
      if (!isObj(change) || !isObj(change['value'])) continue;
      const field = str(change['field']) ?? '';
      const value = change['value'];
      const metadata = isObj(value['metadata']) ? value['metadata'] : {};
      const phoneNumberId = str(metadata['phone_number_id']) ?? `waba:${wabaId}`;

      if (field === 'messages') {
        const contatos = arr(value['contacts']).filter(isObj);
        for (const message of arr(value['messages'])) {
          if (!isObj(message)) continue;
          const id = str(message['id']);
          if (!id) continue;
          const from = str(message['from']);
          const fromUserId = str(message['from_user_id']);
          const contato =
            contatos.find(
              (c) => (from && c['wa_id'] === from) || (fromUserId && c['user_id'] === fromUserId),
            ) ?? contatos[0];
          eventos.push({
            phoneNumberId,
            wabaId,
            kind: 'message',
            dedupeKey: `message:${id}`,
            orderKey: `${phoneNumberId}:${fromUserId ?? from ?? 'desconhecido'}`,
            payload: { metadata, message, ...(contato ? { contact: contato } : {}) },
          });
        }
        for (const status of arr(value['statuses'])) {
          if (!isObj(status)) continue;
          const id = str(status['id']);
          const estado = str(status['status']);
          if (!id || !estado) continue;
          eventos.push({
            phoneNumberId,
            wabaId,
            kind: 'status',
            dedupeKey: `status:${id}:${estado}`,
            payload: { metadata, status },
          });
        }
        continue;
      }

      if (field === 'smb_message_echoes') {
        for (const echo of arr(value['message_echoes'])) {
          if (!isObj(echo)) continue;
          const id = str(echo['id']);
          if (!id) continue;
          const to = str(echo['to_user_id']) ?? str(echo['to']);
          eventos.push({
            phoneNumberId,
            wabaId,
            kind: 'echo',
            dedupeKey: `echo:${id}`,
            orderKey: `${phoneNumberId}:${to ?? 'desconhecido'}`,
            payload: { metadata, echo },
          });
        }
        continue;
      }

      const porCampo: Readonly<Record<string, CloudEventKind>> = {
        history: 'history',
        smb_app_state_sync: 'app_state_sync',
        message_template_status_update: 'template_status',
        account_update: 'account_update',
        phone_number_quality_update: 'quality',
        user_preferences: 'user_preferences',
      };
      const kind = porCampo[field] ?? 'desconhecido';
      eventos.push({
        phoneNumberId,
        wabaId,
        kind,
        dedupeKey: `${kind}:${phoneNumberId}:${hashOf(value)}`,
        payload: { field, metadata, value },
      });
    }
  }

  return eventos;
};
