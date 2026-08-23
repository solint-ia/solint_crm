import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Sora } from 'next/font/google';
import { themeBootstrapScript } from '@/lib/theme';
import './globals.css';

const sora = Sora({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-sora',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Solint CRM',
    template: '%s · Solint CRM',
  },
  description:
    'CRM omnichannel com foco em WhatsApp: conversas, funil de vendas, agentes de IA e campanhas.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F4F7FB' },
    { media: '(prefers-color-scheme: dark)', color: '#050A14' },
  ],
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/* Aplica o tema antes da hidratacao para evitar flash (SKILL.md secao 2.3). */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className={`${sora.variable} ${inter.variable} ${jetbrains.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
