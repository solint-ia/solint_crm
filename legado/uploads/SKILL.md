---
name: solint-crm-design
description: Especificação de design de interface e identidade visual para o CRM Omnichannel WhatsApp da Solint no Claude Design. Une os tokens visuais da marca Solint com padrões ergonômicos de CRM em tempo real (estilo Chatwoot/Whaticket), sem excessos futuristas.
license: Solint Tech - Uso Interno
---

# Solint CRM Omnichannel — Design System & Especificação de UI

Este documento estabelece as diretrizes de design de interface, tokens de estilo, componentes e padrões de experiência do usuário para o desenvolvimento dos protótipos de tela do **CRM Omnichannel voltado para WhatsApp da Solint** (referências: *Chatwoot*, *Whaticket*, *Typebot*), utilizando o Claude Design.

---

## 1. Fundamentação & Propósito do Produto

### 1.1 O que é o Produto
O **Solint CRM** é uma plataforma SaaS de atendimento ao cliente omnichannel multiatendente e multicanal, com foco prioritário e profundo no ecossistema do **WhatsApp (Cloud API / Baileys / Evolution)**, além de suporte integrado a Instagram Direct, Webchat, E-mail e Telegram.

### 1.2 Princípios de Experiência (UX) para CRM Operacional
* **Foco em Produtividade e Ergonomia**: Operadores utilizam a interface durante turnos de 6 a 8 horas diárias. O design deve priorizar **baixo cansaço visual**, contraste equilibrado e altíssima velocidade de leitura.
* **Eliminação de Excessos Futuristas**: Não utilizar efeitos de ficção científica, partículas flutuantes, animações 3D contínuas, malhas orbitais, scanlines ou cantos chanfrados aeroespaciais. O CRM precisa transparecer solidez corporativa, eficiência moderna e confiabilidade institucional.
* **Estrutura é Informação**: Cada divisor, cor de badge e hierarquia tipográfica transmite estado operacional real (ex.: canais, tempo de espera na fila, SLAs, notas internas, status de entrega).
* **Densidade Equilibrada de Dados**: Apresentar contexto completo do cliente sem poluir a área central de conversa.

---

## 2. Paleta de Cores e Tokens Visuais

A paleta combina as cores institucionais da Solint (**Deep Navy, Azul Real, Ciano e Âmbar**) com os tons semânticos indispensáveis para uma operação de atendimento em tempo real.

### 2.1 Cores Primárias da Marca Solint

| Token | Hex | Aplicação no CRM |
| :--- | :--- | :--- |
| `--color-brand-blue` | `#168CFF` | Botões primários, abas ativas, foco de inputs, links e ícones selecionados |
| `--color-blue-deep` | `#174EFF` | Ações de alto contraste, cabeçalhos de destaque, gradiente institucional |
| `--color-accent-cyan` | `#35D9FF` | Indicadores de automação/IA (Agente Inteligente), badges em dark mode |
| `--color-amber` | `#FFB65C` | **Notas internas privadas**, alertas de SLA, status "Aguardando", prioridade alta |
| `--color-brand-gradient`| `linear-gradient(100deg, #174EFF 0%, #168CFF 52%, #35D9FF 100%)` | Logotipo, banner de upgrade/plano e botões de conversão global |

### 2.2 Cores de Canais & Semântica Operacional

| Canal / Status | Hex / Cor | Uso no Sistema |
| :--- | :--- | :--- |
| **WhatsApp Oficial** | `#25D366` / `#128C7E` | Ícone do WhatsApp, balão de envio rápido (modo WA), indicador Online |
| **Instagram Direct** | `#E1306C` | Badge do canal Instagram |
| **Webchat / Portal** | `#6366F1` | Badge do canal Webchat integrado |
| **Telegram** | `#0088CC` | Badge do canal Telegram |
| **Status Aberto / Online** | `#10B981` (Emerald) | Conversa em andamento, atendente disponível |
| **Status Pendente / Fila** | `#F59E0B` / `#FFB65C` | Conversa aguardando atendente ou resposta do cliente |
| **Status Resolvido / Fechado** | `#64748B` (Slate) | Conversas encerradas, atendimentos arquivados |
| **Status Urgente / Erro** | `#EF4444` (Rose/Red) | Falha no envio de mensagem, SLA estourado, cancelamentos |
| **Nota Interna Privada** | Fundo `#FFFBEB` / Borda `#FCD34D` (Light) ou Fundo `#1E1A11` / Borda `#FFB65C/40` (Dark) | Mensagens visíveis apenas para a equipe interna |

---

### 2.3 Modos de Visualização (Light & Dark)

#### A. Clean / Light Mode (Recomendado para Alta Produtividade Diurna)
* **Background da Aplicação**: `#F4F7FB` (Solint Paper)
* **Superfícies & Painéis (Cards, Colunas)**: `#FFFFFF`
* **Bordas & Divisores**: `#E2E8F0` ou `#E5E9F0`
* **Texto Principal**: `#0A1424` (Preto azulado de alta legibilidade)
* **Texto Secundário / Muted**: `#5B6472`
* **Balão do Cliente (Entrada)**: `#FFFFFF` com borda fina `#E2E8F0`
* **Balão do Atendente (Saída)**: `#E8F3FF` (Azul Solint suave) com texto `#0A2540` ou `#D9FDD3` (Verde suave WhatsApp)

#### B. Dark Mode (Identidade Corporativa Solint)
* **Background da Aplicação**: `#050A14` (Solint Ink)
* **Superfícies de Painéis (Sidebar, Lista de Chats)**: `#0D121A` (Solint Panel)
* **Superfície Ativa / Destaque**: `#141A24` (Surface Hi)
* **Bordas & Divisores**: `rgba(255, 255, 255, 0.08)` ou `rgba(53, 217, 255, 0.14)`
* **Texto Principal**: `#FAFCFF`
* **Texto Secundário / Muted**: `#A3AEBD`
* **Balão do Cliente (Entrada)**: `#141A24` com borda `rgba(255, 255, 255, 0.06)`
* **Balão do Atendente (Saída)**: `#0E335C` (Azul escuro Solint) ou `#005C4B` (WhatsApp Dark)

---

## 3. Tipografia e Hierarquia

A tipografia preserva o par oficial da Solint, ajustado para legibilidade em sistemas de alta densidade:

1. **Display & Títulos (`--font-display: Sora`)**:
   * Utilizada em: Logomarca, títulos de módulos, nomes de clientes no cabeçalho do chat, números de indicadores e dashboards.
   * Pesos: `500 (Medium)`, `600 (Semi-bold)`, `700 (Bold)`.
   * Sensação: Moderna, humana, sólida, sem ser excessivamente geométrica.

2. **Interface, Dados e Conversação (`--font-sans: Inter`)**:
   * Utilizada em: Balões de mensagens, lista de conversas, campos de formulário, botões, tags e menus.
   * Pesos: `400 (Regular)`, `500 (Medium)`, `600 (Semi-bold)`.
   * Vantagem: Máxima legibilidade em tamanhos pequenos (`12px` a `14px`), com clareza em numerais e pontuações.

3. **Metadados e Identificadores (`--font-mono`)**:
   * Utilizada em: Protocolos de atendimento (`#AT-84920`), números de telefone (`+55 (79) 9680-9911`), timestamps precisos e payloads de webhook.

---

## 4. Arquitetura Estrutural das Telas (Layout Canônico de 4 Colunas)

Para a tela principal de **Atendimento ao Vivo (Live Chat)**, utilize a consagrada divisão em 4 áreas funcionais:

```text
+---+----------------------+------------------------------------------+---------------------+
| N | FILA DE CONVERSAS    | ÁREA DE CHAT ATIVA                       | CONTEXTO DO CONTATO |
| A | (320px - 360px)      | (Flex-1)                                 | (300px - 340px)     |
| V |                      |                                          |                     |
|   | [Busca & Filtros   ] | [Header: Cliente + Fila + Ações Rápidas] | [Avatar + Dados]    |
| ( | [Minhas | Todas | +] | ---------------------------------------- | [Tags do Contato]   |
| 6 |                      | [Timeline de Mensagens                 ] | [Campos Extras]     |
| 4 | [Item de Conversa  ] | [ - Balão Cliente                      ] | [Protocolo Atual]   |
| p | [ - Nome + Avatar  ] | [ - Balão Atendente                    ] | [Histórico Tickets] |
| x | [ - Canal + Tag    ] | [ - Nota Interna (Âmbar)               ] | [Anotações Rápidas] |
| ) | [ - Prévia + Horas ] | [ - Ação do Bot IA (Ciano)             ] |                     |
|   |                      | ---------------------------------------- |                     |
|   |                      | [Barra de Composição & Ações           ] |                     |
|   |                      | [Público / Nota Interna | Áudio | Anexo] |                     |
+---+----------------------+------------------------------------------+---------------------+
```

### 4.1 Coluna 1: Navigation Rail (Barra Lateral Global — 64px)
* **Topo**: Logo Solint (versão ícone compacto).
* **Navegação Central**:
  * 📥 **Caixa de Entrada** (Ícone com badge de não lidos)
  * 👥 **Contatos / CRM** (Base de clientes unificada)
  * 📊 **Kanban / Oportunidades** (Funil de vendas e atendimento)
  * 🤖 **Agentes de IA / Bots** (Configuração de fluxos e handoff)
  * 📢 **Disparos / Campanhas** (Envios em massa e templates HSM)
  * 📈 **Dashboard & Relatórios** (TMA, TME, CSAT, volume por canal)
  * ⚙️ **Configurações & Conexões** (WhatsApp QR Code, Webhooks, Filas)
* **Rodapé**: Foto do atendente, toggle de status (**Disponível / Ocupado / Ausente**) e botão de tema (Dark/Light).

### 4.2 Coluna 2: Lista de Conversas / Inbox (320px a 360px)
* **Barra de Controle Superior**:
  * Campo de busca global com atalho visual (`⌘K` ou `Ctrl+K`).
  * Abas rápidas: **Minhas** (atribuídas ao usuário), **Não Atribuídas** (fila aberta), **Todas**.
  * Filtro por Departamentos/Filas (*Comercial, Suporte N1, Financeiro*).
* **Card de Conversa (Item da Lista)**:
  * Avatar com indicador de status do contato.
  * Nome do cliente com ícone do canal em miniatura (WhatsApp verde, Instagram rosa, etc.).
  * Prévia da última mensagem com indicador de remetente (Você:, Cliente:, Bot:).
  * Hora da última interação (`14:28` ou `Há 3m`).
  * Contador de mensagens não lidas com fundo azul Solint (`#168CFF`).
  * Tags de identificação compactas (*Ex.: VIP, Suporte, Proposta Enviada*).

### 4.3 Coluna 3: Janela Central de Conversação
* **Cabeçalho da Conversa**:
  * Dados essenciais do cliente (Nome, Telefone, Canal).
  * Fila/Departamento atual e Atendente responsável.
  * Botões de Ação Imediata:
    * **Transferir** (para outra fila ou atendente específico).
    * **Pendente** (aguardando retorno com lembrete).
    * **Resolver / Finalizar** (botão de destaque com confirmação rápida).
* **Área de Mensagens (Timeline)**:
  * Divisores de data suaves (`Hoje`, `Ontem`, `15 de Outubro`).
  * Balões com diferenciação nítida entre Cliente, Atendente e Robô de IA.
  * **Bloco de Nota Interna**: Fundo âmbar suave com ícone de cadeado e aviso *"Visível apenas para a equipe"*.
  * Status de envio do WhatsApp: Relógio (enviando), 1 check cinza (enviado), 2 checks cinzas (entregue), 2 checks azuis (lido).
  * Reprodutor de áudio integrado com barra de progresso, botão 1.5x/2x e transcrição automática por IA.
* **Barra de Composição (Composer)**:
  * Alternador de modo: **"Mensagem Pública"** vs **"Nota Interna Privada"**.
  * Dica de atalhos visíveis: Digite `/` para **Respostas Rápidas**.
  * Botão de anexar arquivo (documento, imagem, vídeo, contato).
  * Gravador de áudio com cancelamento e visualização de ondas.
  * Seletor de Emojis e Modelos de Mensagem (Templates aprovados).
  * Botão de envio primário no tom Azul Solint (`#168CFF`).

### 4.4 Coluna 4: Painel de Contexto do Cliente (300px a 340px)
* **Perfil Rápido**: Nome, empresa, e-mail, telefone, fuso horário e localização.
* **Tags do Contato**: Adicionar/remover etiquetas com cores categorizadas.
* **Campos Customizados**: CPF/CNPJ, Código ERP, Valor de Lead, Vencimento de Fatura.
* **Histórico de Protocolos**: Lista com atendimentos anteriores, responsáveis e motivos de encerramento.
* **Agendamentos & Tarefas**: Próximo follow-up ou lembrete de contato.

---

## 5. Especificações dos Componentes de UI

### 5.1 Botões & CTAs

```css
/* Botão Primário (Ação Principal / Enviar / Finalizar) */
.btn-primary {
  background-color: #168CFF;
  color: #FFFFFF;
  font-weight: 500;
  border-radius: 8px;
  padding: 8px 16px;
  transition: background-color 0.2s ease, transform 0.1s ease;
}
.btn-primary:hover {
  background-color: #1377DB;
}

/* Botão Secundário / Outline */
.btn-secondary {
  background-color: transparent;
  border: 1px solid #E2E8F0; /* Dark: rgba(255,255,255,0.12) */
  color: #0A1424;            /* Dark: #FAFCFF */
  border-radius: 8px;
  padding: 8px 16px;
}
.btn-secondary:hover {
  background-color: #F4F7FB; /* Dark: #141A24 */
}

/* Botão de Destaque Especial (Gradiente Solint) */
.btn-solint-gradient {
  background: linear-gradient(100deg, #174EFF 0%, #168CFF 52%, #35D9FF 100%);
  color: #FFFFFF;
  font-weight: 600;
  border-radius: 8px;
  box-shadow: 0 4px 14px rgba(22, 140, 255, 0.25);
}
```

### 5.2 Badges & Tags

* **Tag de Canal WhatsApp**: Fundo `#E8F9EE`, texto `#0E803C`, ícone do WhatsApp.
* **Tag de Fila Financeiro**: Fundo `#EDE9FE`, texto `#6D28D9`.
* **Tag de Fila Comercial**: Fundo `#E0F2FE`, texto `#0369A1`.
* **Tag de Nota Interna / SLA**: Fundo `#FEF3C7`, texto `#B45309`, borda `#FDE68A`.
* **Tag de IA / Solint AI**: Fundo `#E0F7FF`, texto `#007799`, borda `#B7E9FF`.

### 5.3 Balões de Mensagens (Chat Bubbles)

* **Raio de Borda (Border Radius)**: `12px` nos cantos com corte suave no canto do remetente (`4px`).
* **Mensagem Recebida (Cliente)**:
  * Alinhada à esquerda.
  * Fundo branco `#FFFFFF` (Light) ou `#141A24` (Dark).
  * Sombra sutil: `0 1px 3px rgba(0, 0, 0, 0.05)`.
* **Mensagem Enviada (Atendente)**:
  * Alinhada à direita.
  * Fundo `#E8F3FF` (Light) ou `#0E335C` (Dark).
  * Texto com contraste nítido, hora no canto inferior direito ao lado dos checks de leitura.
* **Nota Interna Privada**:
  * Alinhada ao centro ou ocupando 90% da largura.
  * Borda tracejada ou sólida em tom âmbar (`#FFB65C`).
  * Fundo âmbar bem suave com ícone de cadeado.

---

## 6. Padrões de Microcópia (Copywriting no CRM)

Seguindo as diretrizes de redação para interfaces corporativas:

* **Voz Ativa e Clara**: Usar termos objetivos e padronizados:
  * *"Transferir atendimento"* (e não *"Mover chat"*)
  * *"Finalizar atendimento"* (e não *"Concluir sessão"*)
  * *"Assumir conversa"* (para tickets da fila pública)
  * *"Adicionar nota privada"*
  * *"Aplicar resposta rápida"*
* **Tratamento de Estados Vazios (Empty States)**:
  * Fila vazia: *"Tudo limpo por aqui! Nenhuma mensagem aguardando atendimento na sua fila."*
  * Sem conversa selecionada: *"Selecione uma conversa ao lado para iniciar o atendimento."*
  * Nenhum contato encontrado: *"Nenhum contato corresponde ao filtro. [Criar novo contato]"*
* **Mensagens de Erro Transparentes**:
  * *"Falha ao enviar mensagem: O número de WhatsApp é inválido ou não possui conta ativa."*
  * *"Sessão expirada do WhatsApp Web. [Reconectar QR Code]"*

---

## 7. Checklist para Criação de Novas Telas no Claude Design

Ao desenhar ou prototipar qualquer tela do Solint CRM, valide:

1. [ ] **Sem elementos futuristas**: Não há malhas 3D girando, linhas laser, scanlines ou botões neon exagerados.
2. [ ] **Consistência de Cores**: O Azul Solint (`#168CFF`) comanda as ações primárias e o Âmbar (`#FFB65C`) indica notas privadas e alertas.
3. [ ] **Tipografia Fiel**: Títulos e cabeçalhos em **Sora**, textos de leitura e listas em **Inter**.
4. [ ] **Densidade e Espaçamento**: Espaçamentos estruturados em escala de 4px (`p-2`, `p-3`, `p-4`, `gap-2`, `gap-3`).
5. [ ] **Visibilidade de Status**: É possível bater o olho e saber o canal, o tempo de espera, o responsável e o status do ticket.
6. [ ] **Acessibilidade**: Contraste de texto com conformidade mínima WCAG AA sobre qualquer plano de fundo.
