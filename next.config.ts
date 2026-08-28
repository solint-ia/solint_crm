import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV === 'development';

/**
 * Cabeçalhos de segurança aplicados a todas as rotas.
 * Ver REGRAS-GLOBAIS.md §6 (Segurança de aplicação web).
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), interest-cohort=()' },
  ...(isDev
    ? []
    : [
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
      ]),
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
      `connect-src 'self'${isDev ? ' ws: wss: http: https:' : ''}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      ...(isDev ? [] : ['upgrade-insecure-requests']),
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  /**
   * Pacotes que o bundler nao deve empacotar.
   *
   * O Prisma carrega binarios em tempo de execucao, e o `pg` abre socket TCP:
   * empacotados, o Next perde o caminho e o servidor sobe sem conseguir falar
   * com o banco.
   */
  serverExternalPackages: [
    '@prisma/client',
    '@prisma/adapter-pg',
    'pg',
    '@whiskeysockets/baileys',
    'pino',
    'pino-pretty',
    'ws',
    'qrcode',
  ],
  experimental: {
    optimizePackageImports: ['lucide-react'],
    /**
     * Teto do corpo de uma Server Action.
     *
     * O padrão do Next é **1 MB**, e `sendMediaAction` recebe o arquivo inteiro
     * por `FormData`: uma foto comprimida passava por baixo desse teto e um
     * vídeo — ou um áudio de mais de um minuto — nunca passava. O Next recusa a
     * requisição antes de a Server Action rodar, então nada no servidor
     * registrava a recusa e a tela não recebia `{ ok: false }` nenhum; só uma
     * promessa rejeitada. Era essa a diferença entre "imagem envia" e "vídeo
     * não envia".
     *
     * O valor acompanha `MAX_UPLOAD_BYTES` (16 MB) com folga para o
     * envelope multipart, que sempre acrescenta alguns por cento.
     */
    serverActions: { bodySizeLimit: '20mb' },
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Mídia recebida de terceiros: servida isolada, sem poder executar nada.
      {
        source: '/api/whatsapp/media/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "default-src 'none'; sandbox" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
};


export default nextConfig;

