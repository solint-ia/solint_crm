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
   * `better-sqlite3` e um addon nativo: empacotado, o Next perde o caminho do
   * `.node` e o servidor sobe sem conseguir abrir o banco. O Prisma entra pelo
   * mesmo motivo — carrega binarios em tempo de execucao.
   */
  serverExternalPackages: [
    '@prisma/client',
    '@prisma/adapter-better-sqlite3',
    'better-sqlite3',
    '@whiskeysockets/baileys',
    'pino',
    'pino-pretty',
    'ws',
    'qrcode',
  ],
  experimental: {
    optimizePackageImports: ['lucide-react'],
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

