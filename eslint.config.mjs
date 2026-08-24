import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: ['.next/**', 'node_modules/**', 'legado/**', 'src/generated/**'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  {
    /**
     * A conta nao pode voltar a ser uma constante.
     *
     * `ACCOUNT_ID` existe para a carga inicial (`prisma/seed.ts`, fora de `src`).
     * Importa-lo em codigo de runtime foi exatamente o defeito da Fase 2: toda
     * mensagem recebida do WhatsApp era gravada na conta de demonstracao,
     * qualquer que fosse a conta de quem conectou. A conta vem da sessao, da
     * `Inbox` ou de um parametro -- nunca de um modulo de seed.
     */
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/infrastructure/seed/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/infrastructure/seed/workspace',
              importNames: ['ACCOUNT_ID', 'ACCOUNTS', 'USERS', 'ROLES', 'LABELS'],
              message:
                'A conta vem da sessao, da Inbox ou de um parametro. Ver PLANO-BACKEND.md, Fase 2.',
            },
          ],
        },
      ],
    },
  },
  {
    // A camada de dominio nao pode depender de framework nem de infraestrutura (DIP).
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['next', 'next/*', 'react', 'react-dom', '@/infrastructure/*', '@/app/*'],
              message:
                'src/core deve permanecer puro: sem React, Next ou infraestrutura. Ver REGRAS-GLOBAIS.md §3.',
            },
          ],
        },
      ],
    },
  },
];

export default config;
