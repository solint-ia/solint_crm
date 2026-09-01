# O que mudou no sistema

Este arquivo explica, em palavras simples, tudo o que foi feito recentemente no
Solint CRM. Não é um documento técnico — é para você entender o que mudou sem
precisar ler código.

---

## 1. Campanhas e Agentes de IA foram desligados por enquanto

Essas duas telas ainda existem por dentro do sistema, mas ficaram escondidas —
ninguém consegue mais abri-las, nenhum papel de usuário, nenhum atalho na URL.
Isso foi combinado porque elas não são o foco da versão que vai para produção
agora.

**Importante:** nada foi apagado. O código continua todo lá, guardado, pronto
para ser religado quando a decisão for essa. E uma parte que já funcionava —
enviar um modelo aprovado de mensagem do WhatsApp dentro de uma conversa
normal — continua funcionando normalmente, porque isso não depende da tela de
Campanhas.

---

## 2. Kanban: ícones trocados e "probabilidade" removida

Duas mudanças visuais simples:

- O ícone do **Kanban** e o do **Dashboard** trocaram de lugar na barra
  lateral, como foi pedido.
- O campo de **probabilidade** (aquele "% de chance de fechar negócio") saiu
  de todo o Kanban — do card, da etapa, dos formulários de criar e editar
  negócio, e do card "Previsão de Fechamento" que dependia dele.

Uma descoberta durante essa limpeza: esse campo de probabilidade **nunca foi
salvo no banco de dados** de verdade. Ele aparecia na tela, mas era só
enfeite — o valor nunca ia para lugar nenhum. Ou seja, removê-lo não perdeu
nenhuma informação real, porque não havia informação real ali.

---

## 3. Uma área nova só para você administrar tudo: `/plataforma`

Antes, qualquer administrador de qualquer conta cliente conseguia criar
webhooks e tokens de API pela tela de Configurações. Isso saiu de todo mundo.

Agora existe uma área separada, `/plataforma`, que só **você** enxerga (o
login `llx.webpro@gmail.com`, que já está configurado e ativo). Nela, você
consegue:

- Ver a lista de todas as contas de clientes cadastradas no sistema
- Entrar em qualquer conta e gerenciar os webhooks dela
- Gerenciar o webhook específico de cada caixa de WhatsApp daquela conta
- Criar e revogar tokens de API daquela conta

Nenhum cliente vê essa área nem sabe que ela existe. Quando você faz login
com esse e-mail, cai direto nela em vez de cair no CRM normal.

**A senha que ficou configurada é a que você pediu.** Recomendo trocá-la em
algum momento pelo próprio sistema, já que ela passou por esta conversa.

---

## 4. Permissões: agora dá para personalizar quem vê o quê

Essa foi a mudança mais profunda. Antes existiam só dois tipos de acesso:
"Administrador" (vê e mexe em tudo) e "Agente" (uma lista fixa e igual para
todo mundo). Não dava para dizer "esse colaborador só pode ver o Kanban" ou
"esse outro pode ver Contatos e a página de Etiquetas, mas nada além disso".

Agora existem **três papéis**:

- **Administrador** — continua com acesso total, inclusive à própria tela de
  permissões. Esse papel não pode ser editado — é de propósito, para a conta
  nunca ficar sem ninguém que consiga desfazer um erro.
- **Supervisor** (novo, de verdade) — enxerga toda a operação (todas as
  caixas de WhatsApp, os relatórios) mas não mexe na estrutura da conta por
  padrão. Um administrador pode dar a ele o poder de gerenciar a equipe, se
  quiser.
- **Colaborador** (era chamado de "Agente") — atende conversas e cuida dos
  contatos das caixas da equipe dele.

E o mais importante: **cada pessoa pode ter permissões diferentes das do
papel dela.** Um administrador agora consegue, na tela de Equipe, abrir o
perfil de qualquer colaborador ou supervisor e marcar/desmarcar permissões
específicas — exatamente o exemplo que foi pedido: "colaborador X pode ver o
Kanban, colaborador Y pode ver Contatos e a sub-página de Etiquetas".

A tela de "Papéis e Permissões" também virou um editor de verdade — antes só
mostrava uma lista sem poder mexer em nada. Agora o administrador pode marcar
e desmarcar permissões ali, com uma explicação em cada caixinha.

**Uma trava de segurança importante:** só administrador mexe em permissões.
Um supervisor com poder de gerenciar equipe **não consegue** promover
ninguém a administrador, nem editar ou remover um administrador existente —
mesmo que ele tente forçar isso por fora da tela.

**Outra regra nova:** um colaborador precisa obrigatoriamente estar em pelo
menos uma equipe. Sem equipe, ele acabaria enxergando todas as caixas de
WhatsApp da conta, o que é o oposto do que faz sentido para esse papel.

Também aproveitei para ligar uma permissão de exportar contatos que já
existia no sistema, mas nunca era realmente checada — o botão de exportar
aparecia para todo mundo, independente da permissão.

---

## 5. Kanban separado por número de WhatsApp

Se a conta tem duas conexões de WhatsApp (dois números), agora cada uma pode
ter o próprio funil de vendas, com um seletor no topo da tela para trocar
entre eles. Uma conta com um número só continua vendo exatamente o que via
antes — o seletor só aparece quando há mais de um funil para escolher.

Quando uma caixa de WhatsApp é excluída, o funil dela **não é apagado** — ele
vira um funil "avulso" e continua existindo, com todo o histórico de
negócios preservado.

---

## 6. Bug corrigido: mensagem para grupo não enviava em certas caixas

Você tinha relatado: às vezes, ao tentar mandar mensagem para um grupo pela
aba de Contatos, aparecia "não foi possível enviar, dados inválidos" — mas
trocando a caixa de WhatsApp, funcionava.

**A causa:** o sistema tinha um limite de tamanho para o "identificador" de
cada conversa, e esse limite era pequeno demais para caixas de WhatsApp
criadas pela tela de Configurações (o identificador delas é mais longo que o
das caixas criadas no cadastro inicial). Grupos, especialmente, esbarravam
nesse limite com facilidade; conversas individuais quase nunca.

**A correção:** aumentei bastante essa margem, calculando o pior caso
possível para não voltar a acontecer, nem com formatos que o WhatsApp venha a
usar no futuro.

Enquanto investigava, descobri que o problema também afetaria **responder**
a um grupo que mandasse mensagem primeiro (não só iniciar a conversa), então
a correção cobre os dois casos, além da API pública que outros sistemas usam
para integrar.

---

## 7. Bug corrigido: conexões de WhatsApp caindo sozinhas durante o deploy

Você relatou que, ao fazer deploy, às vezes uma conexão de WhatsApp caía (de
forma aparentemente aleatória) enquanto outras continuavam normais.

**O que estava acontecendo:** durante um deploy, por alguns segundos, o
processo antigo (que estava sendo desligado) e o processo novo (que estava
subindo) ficavam ativos ao mesmo tempo. Quando os dois tentavam usar o mesmo
número de WhatsApp nesse intervalo, o próprio WhatsApp detectava a
"duplicidade" e derrubava uma das duas conexões — e qual delas caía dependia
de detalhes de tempo, o que dava a impressão de sorteio.

Encontrei três problemas encadeados que causavam isso:

1. Quando o WhatsApp derrubava uma conexão por esse motivo, o sistema **não
   tentava reconectar sozinho** — ela ficava caída até alguém entrar na tela
   e clicar em "Conectar" de novo.
2. O sistema tinha uma trava para garantir que só um processo mexesse em cada
   número por vez, mas em alguns casos ele podia **perder essa trava sem
   perceber** — e continuar agindo como se ainda tivesse controle daquele
   número, o que causava exatamente o choque descrito acima.
3. Ao desligar, o processo antigo encerrava as conexões **uma de cada vez**,
   em vez de todas ao mesmo tempo — e se houvesse várias caixas conectadas,
   as últimas da fila às vezes não davam tempo de desligar direito antes do
   processo ser encerrado à força.

Corrigi os três: agora o sistema tenta reconectar sozinho quando isso
acontece (com pausas crescentes entre tentativas, para não entrar num
loop), percebe quando perde a trava de um número e se desliga daquele
número corretamente, e desliga todas as conexões ao mesmo tempo em vez de
uma por uma.

Também conferimos junto com você as variáveis de configuração do Vercel (onde
o site roda) e do Render (onde fica o processo que mantém as conexões de
WhatsApp abertas) — estavam todas corretas, então o problema era mesmo no
código, não na configuração.

---

## 8. Ajustes de tela e a importação de planilhas

Uma rodada de correções depois das fases acima.

**O cabeçalho da conversa embaralhava** quando você arrastava a barra lateral
para a direita: os botões subiam por cima do nome do contato. A causa era o
cabeçalho decidir o que mostrar pela largura da **janela** — e a janela não muda
de tamanho quando a barra lateral cresce. Agora ele olha o próprio espaço
disponível e encolhe junto.

**O QR code do WhatsApp exigia dois cliques.** No primeiro, aparecia
"desconectado"; só no segundo o código surgia. Eram três defeitos somados: a
resposta do servidor vinha num formato que a tela não sabia ler (e por isso
caía em "desconectado"); a tela não tinha como consultar o estado de uma caixa
específica, dependendo só de um aviso que demora segundos; e o indicador de
"carregando" era de baixa prioridade para o navegador, então demorava a
aparecer e dava a impressão de que o clique não tinha funcionado. Os três foram
corrigidos.

**A página de Atributos personalizados foi removida**, conforme pedido.

**A lista de contatos agora tem páginas de 50.** A busca, os filtros e a
ordenação continuam valendo sobre a base inteira — o que mudou é quantas linhas
o navegador desenha de uma vez, que era o que travava a rolagem em bases
grandes.

**A importação de planilhas de prospecção foi refeita.** Analisando um arquivo
real de extração de leads, cinco coisas impediam que ele funcionasse:

- A coluna chamada "WhatsApp" contém "Sim"/"Não", não números — e o sistema
  tentava salvar a palavra "Sim" como telefone. Agora ele reconhece a coluna
  pelo **conteúdo**, não pelo nome.
- Quando existe essa coluna, só entram as linhas marcadas como "Sim" — o
  telefone fixo da recepção fica de fora.
- A mesma pessoa aparece em várias linhas, uma por telefone. Antes viravam
  contatos duplicados; agora viram **um contato com vários números**, e os
  extras ficam visíveis no cadastro e na busca.
- A célula de e-mail traz uma lista inteira separada por ponto e vírgula. Isso
  fazia o sistema recusar a planilha toda. Agora ele pega o primeiro e-mail
  válido.
- Os telefones vêm com parênteses e hífen — `(24) 99829-6234` — e passam a ser
  convertidos para o formato interno do sistema. Nomes em CAIXA ALTA viram
  Maiúsculas Iniciais (mas o nome das empresas fica intacto, porque razão social
  é cheia de sigla).

Antes de importar, a tela agora mostra a conta certa: "200 linhas → 40
contatos", com quantas foram descartadas e quantas foram juntadas.

---

## O que falta você fazer

- **Nada de configuração pendente.** As variáveis de ambiente do Vercel e do
  Render já estão certas.
- **Confirme se o Render redeploya sozinho** quando você dá push no GitHub
  (auto-deploy), ou se precisa clicar manualmente em "Deploy" no painel dele
  — foi a única pergunta que ficou em aberto na nossa conversa.
- Todo o trabalho já foi enviado para o repositório (`git push`), em três
  commits separados por assunto.
