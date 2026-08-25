// Sem `server-only` de proposito, pela mesma razao registrada em
// `infrastructure/auth/password.ts`: o worker de WhatsApp e um processo Node
// comum, fora do Next. O pacote `server-only` lanca sempre que a condicao
// `react-server` nao esta ativa, entao marcar este modulo derrubaria o worker no
// boot. A protecao real e outra: ele so e importado por codigo de servidor, e a
// chave que ele usa nunca sai daqui.

/**
 * Cliente mínimo do Supabase Storage.
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
  /** Fotos de perfil de contatos e grupos. Privado, retenção própria. */
  AVATARS: 'whatsapp-avatars',
} as const;

export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

const config = (): { url: string; key: string } | null => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ''), key };
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

export const storage = {
  /**
   * Grava (ou sobrescreve) um objeto.
   *
   * `x-upsert` porque os identificadores são estáveis: a foto de perfil de um
   * contato é sempre o mesmo caminho, e reenviar a mesma mídia deve substituir,
   * não duplicar.
   */
  async upload(
    bucket: BucketName,
    objectPath: string,
    data: Buffer,
    contentType: string,
  ): Promise<boolean> {
    const cfg = config();
    if (!cfg) return false;

    try {
      const response = await fetch(
        `${cfg.url}/storage/v1/object/${bucket}/${encodeURI(objectPath)}`,
        {
          method: 'POST',
          headers: {
            ...authHeaders(cfg.key),
            'Content-Type': contentType || 'application/octet-stream',
            'x-upsert': 'true',
            'cache-control': '3600',
          },
          body: new Uint8Array(data),
        },
      );

      if (!response.ok) {
        console.warn(
          `[supabase-storage] Falha ao gravar ${bucket}/${objectPath}: ${response.status} ${await response.text()}`,
        );
        return false;
      }
      return true;
    } catch (error) {
      console.warn(`[supabase-storage] Erro de rede ao gravar ${bucket}/${objectPath}:`, error);
      return false;
    }
  },

  async download(bucket: BucketName, objectPath: string): Promise<Buffer | null> {
    const cfg = config();
    if (!cfg) return null;

    try {
      const response = await fetch(
        `${cfg.url}/storage/v1/object/${bucket}/${encodeURI(objectPath)}`,
        { headers: authHeaders(cfg.key) },
      );
      if (!response.ok) return null;
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      console.warn(`[supabase-storage] Erro de rede ao ler ${bucket}/${objectPath}:`, error);
      return null;
    }
  },

  /** Remove objetos. Silencioso: apagar o que já não existe não é erro. */
  async remove(bucket: BucketName, objectPaths: readonly string[]): Promise<void> {
    const cfg = config();
    if (!cfg || objectPaths.length === 0) return;

    try {
      await fetch(`${cfg.url}/storage/v1/object/${bucket}`, {
        method: 'DELETE',
        headers: { ...authHeaders(cfg.key), 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [...objectPaths] }),
      });
    } catch (error) {
      console.warn(`[supabase-storage] Erro ao remover de ${bucket}:`, error);
    }
  },
};
