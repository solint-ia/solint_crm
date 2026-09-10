// Sem `server-only` de proposito, pela mesma razao registrada em
// `infrastructure/auth/password.ts`: o worker de WhatsApp e um processo Node
// comum, fora do Next. O pacote `server-only` lanca sempre que a condicao
// `react-server` nao esta ativa, entao marcar este modulo derrubaria o worker no
// boot. A protecao real e outra: ele so e importado por codigo de servidor, e a
// chave que ele usa nunca sai daqui.

/**
 * Cliente mínimo de armazenamento de objetos: OCI Object Storage ou Supabase
 * Storage (ver `config`). O arquivo guarda o nome antigo porque é importado por
 * meia dúzia de módulos, e o nome não muda nada no que ele faz.
 *
 * **Por que não o `@supabase/supabase-js`.** Este projeto fala com o Postgres
 * direto pelo Prisma e nunca usou o SDK do Supabase para dado nenhum — são três
 * chamadas HTTP, e uma dependência inteira para fazê-las não caberia num
 * `package.json` que hoje tem dezesseis entradas. A API REST do Storage é
 * estável e documentada; o que ela pede é um `Authorization` e um caminho.
 *
 * A chave secreta **ignora RLS**: ela lê e escreve qualquer arquivo do projeto.
 * Por isso ele nunca deve ser importado por componente de cliente — ver a nota
 * sobre `server-only` no topo do arquivo.
 */

export const BUCKETS = {
  /** Mídia de conversa (imagem, vídeo, áudio, documento). Privado. */
  MEDIA: 'whatsapp-media',
  /**
   * Fotos de perfil de contatos e grupos do WhatsApp, foto de perfil das
   * pessoas do CRM e logotipo de cada conta. Privado, retenção própria.
   *
   * Um bucket só para as três: são todas "uma imagem pequena, identidade
   * visual de alguém", e cada uma vive num prefixo de caminho diferente
   * dentro dele (contatos por `accountId`, pessoas em `users/<userId>`,
   * contas em `accounts/<accountId>`) — não colidem entre si.
   */
  AVATARS: 'whatsapp-avatars',
} as const;

export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

/**
 * Onde os bytes moram: dois transportes para as mesmas operações.
 *
 * **OCI Object Storage por URL pré-autenticada (PAR).** Uma PAR de bucket com
 * leitura e escrita é uma URL-prefixo onde `PUT` e `GET` de `{par}{objeto}`
 * funcionam sem assinatura nenhuma — o segredo é a própria URL. Isso poupa
 * implementar SigV4 ou trazer o SDK da Oracle para fazer duas chamadas HTTP.
 * Um bucket só atende os dois lógicos: o nome do objeto é `{bucket}/{caminho}`,
 * o mesmo texto que `MediaObject.bucketPath` já grava, então a cópia dos
 * objetos vindos do Supabase cai exatamente onde a leitura vai procurar.
 *
 * **Supabase Storage**, o transporte original, continua valendo para quem não
 * definiu a PAR. A PAR vence quando as duas existem: é a configuração mais
 * nova, e ter as duas no ambiente só acontece no meio de uma migração.
 */
type Backend =
  | { readonly kind: 'oci'; readonly parUrl: string }
  | { readonly kind: 'supabase'; readonly url: string; readonly key: string };

const config = (): Backend | null => {
  const par = process.env.OBJECT_STORAGE_PAR_URL?.trim();
  if (par) return { kind: 'oci', parUrl: par.endsWith('/') ? par : `${par}/` };

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return { kind: 'supabase', url: url.replace(/\/+$/, ''), key };
};

/**
 * O Storage está configurado?
 *
 * Devolver `false` em vez de lançar é deliberado: sem as variáveis, o depósito
 * cai para o cache local e a aplicação continua de pé. Perder a durabilidade da
 * mídia é ruim; derrubar o atendimento inteiro por causa dela é pior.
 */
export const isStorageConfigured = (): boolean => config() !== null;

const authHeaders = (key: string): Record<string, string> => ({
  Authorization: `Bearer ${key}`,
  apikey: key,
});

/**
 * URL e cabeçalhos de um objeto no transporte ativo.
 *
 * A URL da PAR **nunca** vai para o log: quem a lê tem leitura e escrita no
 * bucket inteiro. Os avisos abaixo citam só `bucket/caminho`.
 */
const objectRequest = (
  cfg: Backend,
  bucket: BucketName,
  objectPath: string,
): { readonly url: string; readonly headers: Record<string, string> } =>
  cfg.kind === 'oci'
    ? { url: `${cfg.parUrl}${encodeURI(`${bucket}/${objectPath}`)}`, headers: {} }
    : {
        url: `${cfg.url}/storage/v1/object/${bucket}/${encodeURI(objectPath)}`,
        headers: authHeaders(cfg.key),
      };

export const storage = {
  /**
   * Grava (ou sobrescreve) um objeto.
   *
   * Sobrescrever porque os identificadores são estáveis: a foto de perfil de um
   * contato é sempre o mesmo caminho, e reenviar a mesma mídia deve substituir,
   * não duplicar. No Supabase isso pede `x-upsert`; no OCI o `PUT` já substitui.
   */
  async upload(
    bucket: BucketName,
    objectPath: string,
    data: Buffer,
    contentType: string,
  ): Promise<boolean> {
    const cfg = config();
    if (!cfg) return false;

    const { url, headers } = objectRequest(cfg, bucket, objectPath);
    try {
      const response = await fetch(url, {
        method: cfg.kind === 'oci' ? 'PUT' : 'POST',
        headers: {
          ...headers,
          'Content-Type': contentType || 'application/octet-stream',
          ...(cfg.kind === 'supabase' ? { 'x-upsert': 'true', 'cache-control': '3600' } : {}),
        },
        body: new Uint8Array(data),
      });

      if (!response.ok) {
        console.warn(
          `[storage:${cfg.kind}] Falha ao gravar ${bucket}/${objectPath}: ${response.status} ${await response.text()}`,
        );
        return false;
      }
      return true;
    } catch (error) {
      console.warn(`[storage:${cfg.kind}] Erro de rede ao gravar ${bucket}/${objectPath}:`, error);
      return false;
    }
  },

  async download(bucket: BucketName, objectPath: string): Promise<Buffer | null> {
    const cfg = config();
    if (!cfg) return null;

    const { url, headers } = objectRequest(cfg, bucket, objectPath);
    try {
      const response = await fetch(url, { headers });
      // Sem este aviso, um bucket ausente ou uma chave sem permissão viravam um
      // `404` na rota de mídia sem rastro nenhum no log de quem serviu.
      if (!response.ok) {
        console.warn(
          `[storage:${cfg.kind}] Falha ao ler ${bucket}/${objectPath}: ${response.status}`,
        );
        return null;
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      console.warn(`[storage:${cfg.kind}] Erro de rede ao ler ${bucket}/${objectPath}:`, error);
      return null;
    }
  },

  /**
   * Remove objetos. Silencioso: apagar o que já não existe não é erro.
   *
   * **No OCI não remove nada, e diz isso no log.** Uma PAR só concede leitura
   * e escrita — o `DELETE` exige a API assinada. Nenhum código chama este
   * método hoje; quem passar a chamá-lo com o OCI ativo precisa trocar o
   * transporte, e o aviso é o que impede esse dia de passar em silêncio.
   */
  async remove(bucket: BucketName, objectPaths: readonly string[]): Promise<void> {
    const cfg = config();
    if (!cfg || objectPaths.length === 0) return;

    if (cfg.kind === 'oci') {
      console.warn(
        `[storage:oci] ${objectPaths.length} objeto(s) de ${bucket} não removido(s): ` +
          'a URL pré-autenticada não permite DELETE.',
      );
      return;
    }

    try {
      await fetch(`${cfg.url}/storage/v1/object/${bucket}`, {
        method: 'DELETE',
        headers: { ...authHeaders(cfg.key), 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [...objectPaths] }),
      });
    } catch (error) {
      console.warn(`[storage:supabase] Erro ao remover de ${bucket}:`, error);
    }
  },
};
