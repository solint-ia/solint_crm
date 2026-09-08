# Deploy independente do worker de WhatsApp

O site e o worker têm ciclos de deploy separados. Alterações apenas em páginas,
componentes e rotas do site não devem reiniciar o processo que mantém as sessões
do WhatsApp abertas.

O workflow `.github/workflows/deploy-whatsapp-worker.yml` valida e solicita um
deploy do worker somente quando muda uma dependência do processo persistente.
Ele também permite um deploy manual pela aba **Actions** do GitHub.

## Configuração única

1. No serviço do worker no Render, abra **Settings > Build & Deploy** e desligue
   **Auto-Deploy**. O serviço do site pode manter seu auto-deploy normal.
2. No mesmo serviço, copie a URL de **Deploy Hook**.
3. No repositório GitHub, abra **Settings > Secrets and variables > Actions** e
   crie o secret `RENDER_WHATSAPP_WORKER_DEPLOY_HOOK` com essa URL.

Depois disso, commits que alterem somente o site não acionam nem reiniciam o
worker. Mudanças no motor WhatsApp, banco, rotinas executadas pelo worker ou em
suas dependências acionam o deploy normalmente.

## Sessões

As credenciais do WhatsApp continuam armazenadas de forma cifrada no banco. Um
reinício necessário do worker restaura a mesma sessão; o QR Code só deve voltar
a ser pedido quando o WhatsApp invalidar explicitamente essas credenciais ou
quando o usuário desconectar a sessão.
