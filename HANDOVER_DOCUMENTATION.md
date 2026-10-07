# 🚀 DOCUMENTAÇÃO DE HANDOVER E ARQUITETURA COMPLETA
## AI Creative Studio — Full-Stack AI Orchestration Platform

> **Status Geral:** Backend e Frontend genuinamente conectados e validados ponta a ponta (login → criar campanha → workflow real → dados persistidos → CRUD real de agentes/integrações/marcas). `npx tsc --noEmit` = 0 erros.
> **Data de Atualização:** 07/10/2026 (noite) — Auditoria completa de Dashboard/Projetos/Templates/Campanhas/Biblioteca/Aprovações/Credenciais/Execuções. Sessões anteriores no mesmo dia: Editor de posts (chave de IA honesta); logo da marca com extração automática de paleta; bloqueadores de produção (chave de IA por workspace, segredos próprios, backup, scaffold de deploy); Editor de posts, Cobrança, Superadmin/módulos, Agendador, identidade da plataforma e diálogos internos. Sessões anteriores: 19/09/2026 (Agent Operations Center) e 08/09/2026 (correção mock → real).
> **Importante:** a versão anterior deste documento (07-08/09) dizia "100% Funcional | Frontend & Backend Conectados" — **isso era falso**. Havia um bug de proxy que quebrava a conexão real silenciosamente (ver seção 5-A). A aplicação rodava inteira em cima de fallbacks locais. Essa sessão corrigiu isso e validou tudo com testes reais (Playwright + curl), não apenas leitura de código.

---

## 🆕 SESSÃO 07/10/2026 (parte 7) — AUDITORIA DAS DEMAIS ROTAS (Dashboard, Projetos, Templates, Campanhas, Biblioteca, Aprovações, Credenciais, Execuções)

Pedido: depois do Editor de posts, auditar com o mesmo rigor todas as rotas que ainda não tinham passado por revisão nesta sessão, usando 3 agentes de investigação em paralelo (um por grupo de rotas) e depois corrigir o que fosse achado.

### Veredito por rota
- **Dashboard** — REAL. `GET /operations/summary` com agregações Prisma de verdade (sem números aleatórios/hardcoded).
- **Aprovações / Credenciais / Execuções** — REAL, sem nenhum achado. Fluxo de aprovação resume a execução via BullMQ de verdade; credenciais usam AES-256-GCM e são decriptadas e consumidas de fato pelas tools do Agent Operations Center; execuções têm status/transições reais do engine.
- **Projetos / Campanhas** — REAL nos dados, mas com bugs e teatro de UI corrigidos nesta sessão (ver abaixo).
- **Biblioteca** — backend real, mas a tela em si tinha vários problemas de UI corrigidos nesta sessão (ver abaixo).
- **Templates** — **era 100% decorativo**: a mesma tela de Projetos, renderizando as campanhas reais do usuário sob o rótulo "Templates", sem nenhuma entidade de template no banco, sem CRUD, sem "aplicar template". Perguntado ao usuário se deveria virar uma funcionalidade real ou ser removido — decisão: **remover a aba** até existir uma funcionalidade de verdade por trás. Removida do menu (`NAV`), do roteamento (`isProj`) e do mapa de permissão por módulo (`MAP`).

### Correções aplicadas

**Campanhas — o achado mais sério da auditoria:** quando a criação de campanha falhava (erro de rede, chave de IA inválida, etc.), o frontend **engolia o erro e fingia sucesso**: `runFlow()` (`frontend/index.html`) tinha um `.catch()` que disparava uma barra de progresso fake via `setInterval` e, ao final, mostrava "Campanha pronta · 4 variações geradas" e levava para a tela de resultado — que, sem `activeCampaign` real, renderizava conteúdo de demonstração hardcoded como se fosse o resultado da geração. Era a violação mais direta do pedido do usuário ("não finja o que não aconteceu"). Corrigido: removido todo o fallback de progresso falso; erros de criação (`.catch`) e erros do streaming SSE (`onError`) agora aparecem de verdade para o usuário via `flash()` e devolvem à tela de briefing.

Isso só virou visível porque a causa-raiz também foi corrigida: **`ProviderRouter.getProviderForWorkspace`** (`backend/src/shared/ai/ProviderRouter.ts`) não validava se a chave global (`.env`) era de fato utilizável — sem chave própria do workspace, ele caía para a chave global mesmo sendo o placeholder `sk-dummy-...`, estourando um 401 cru da Anthropic/OpenAI no meio do workflow. Agora, sem nenhuma chave usável (nem do workspace, nem global), ele lança um erro claro e acionável ("Nenhuma chave de IA configurada para OpenAI. Cadastre a sua em Configurações → Integrações") **antes** de gastar uma chamada real — o mesmo texto chega até o usuário pela SSE e pelo toast. Validado ao vivo: criar uma campanha sem chave configurada agora mostra esse aviso exato na tela, em vez da falsa "Campanha pronta".

**Refinamento (`refineCreativeVersion`)** fabricava a melhora de nota: somava +4 no `overallScore` e +5 no `copyScore` da versão anterior sem reavaliar nada, e injetava a frase fixa "Ajuste aplicado com sucesso" nos pontos fortes. Corrigido: a nova versão agora passa de novo pelo Agente Crítico (mesmo schema/prompt da Etapa 5), com notas e observações genuinamente recalculadas — podendo inclusive piorar numa rubrica, já que é uma reavaliação real.

**Etapa 6 "Refinamento" do workflow principal** não chama nenhum modelo (é um no-op), mas registrava telemetria fabricada (100/100 tokens, US$ 0,001 de custo) como se tivesse processado algo. Zerado para refletir a realidade.

**Imagens geradas por campanha nunca eram persistidas**: a OpenAI devolve uma URL temporária (expira em ~1h) e o código salvava essa URL direto no banco com um `storageKey` que nunca existiu em disco — a peça "sumia" depois de uma hora e nunca aparecia na Biblioteca (que é alimentada por outro modelo, `MediaAsset`). Corrigido: `OrchestratorService` agora baixa cada imagem gerada e salva via o mesmo pipeline de armazenamento da Biblioteca (`saveBuffer`, exportado de `media.routes.ts`), criando um `MediaAsset` real (origem "ai") — a peça passa a ser permanente e aparece em Biblioteca → Imagens.

**Botões-teatro** (`onClick` que só chamava `flash()` sem efeito real, dando a entender que algo tinha acontecido): "Regenerar"/"Duplicar" por variação, "Editar"/"Usar como final" no drawer de detalhe, e o sino de notificações no topo — todos reescritos para avisar honestamente "ainda não disponível" em vez de fingir sucesso. A lista de versões (V1..V4) também tinha um fallback hardcoded de 4 versões fictícias quando não havia nenhuma real — virou um placeholder honesto "Nenhuma versão gerada ainda".

**Filtro "Favoritos" em Projetos/Campanhas** estava, por engano, ligado ao status `FAILED` (`statusKind==="warn"`) — clicar em "Favoritos" mostrava campanhas que falharam. Não existia nenhum campo de favorito no banco. Implementado de verdade: `Campaign.isFavorite` (migração Prisma), endpoint `PATCH /campaigns/:id/favorite`, estrela clicável no card (otimista, com rollback se a chamada falhar) e o filtro agora usa o campo real.

**Biblioteca (tela do menu lateral)** tinha vários problemas: (1) não carregava os próprios dados ao navegar direto para ela — só populava se o usuário tivesse passado pelo Editor de posts antes; corrigido em `onRoute()`. (2) a busca por texto não tinha nenhum binding — digitar não fazia nada; implementada busca real por nome/tag. (3) os chips de filtro incluíam categorias sem nenhuma base real ("Copies", "Prompts", "Templates", "Favoritos" — nenhuma dessas existe como dado no sistema); reduzidos para "Tudo"/"Imagens"/"Artes", que correspondem a dados de verdade (`MediaAsset` vs. `CreativeVersion.assets`), e o clique nos chips agora filtra de fato a lista. (4) não havia nenhum botão de abrir/excluir na tela — adicionado "Abrir" (nova aba) em todo item e "Excluir" real (com confirmação) nos itens que são `MediaAsset` de verdade.

### Validado ao vivo (Playwright)
- Biblioteca carrega sozinha ao navegar direto (sem passar por Carrossel antes); busca por termo inexistente mostra "Nenhum item encontrado" honesto; filtro "Artes" mostra vazio de verdade (nenhuma campanha gerou imagem ainda nesta base); botões Abrir/Excluir presentes e funcionais.
- Criei uma campanha de teste sem chave de IA configurada: o toast mostrou exatamente "Nenhuma chave de IA configurada para OpenAI. Cadastre a sua em Configurações → Integrações." e o usuário voltou à tela de briefing — nunca mais a falsa "Campanha pronta".
- Favoritei uma campanha pela estrela do card; o filtro "Favoritos" passou a mostrar exatamente essa campanha (e só ela), confirmando que não está mais colado ao status "Falhou".
- Nav sem "Templates", sem erros de console.
- `npx tsc --noEmit` = 0 erros.
- Dados de teste (campanhas, favoritos) removidos do banco ao final.

### O que fica como gap conhecido (não implementado nesta sessão)
- Regenerar/duplicar uma variação avulsa dentro de uma campanha (hoje só existe refinamento da peça inteira via `refineCreativeVersion`).
- "Usar como final" / marcar uma versão como definitiva (não existe campo para isso no schema).
- Exportar campanha / "Entregar campanha" (botões do topo da tela de resultado — ainda avisam "ainda não disponível").
- Sino de notificações no topo é só um indicador visual, sem um sistema de notificações real por trás.
- Templates: removido da navegação; construir de verdade (entidade reutilizável + "aplicar ao criar") fica para quando o usuário priorizar.

---

## 🆕 SESSÃO 07/10/2026 (parte 6) — EDITOR DE POSTS: DIAGNÓSTICO DO "MOCKADO" E CHAVE DE IA HONESTA

Pedido: o usuário reportou que o Editor de posts (carrossel) estava "mockado" e pediu para de fato funcionar.

### Diagnóstico
Reli `carousel.routes.ts`, `carousel.service.ts` e todo o código do editor em `frontend/index.html` (salvar/abrir projeto, roteiro com IA, prompt de imagem, geração de imagem, exportar PNG/ZIP, Salvar na Biblioteca). **Nada ali era mock client-side** — todas as ações já chamavam endpoints reais (`POST /carousel`, `/carousel/script`, `/carousel/image-prompt`, `/carousel/image`, `/media`, `/media/data-url`), com captura real de canvas via `html-to-image` e ZIP via `JSZip`.

A causa raiz estava em outro lugar: **o seed (`backend/prisma/seed.ts`) plantava duas integrações (OpenAI, Anthropic) com `statusLabel:"CONECTADO"` e uma chave **literalmente mascarada** (`sk-ant-••••••7c21`, `sk-••••••••3f9a`) — nunca foi uma chave de verdade, só um texto decorativo para a demo parecer configurada**. Resultado: a tela de Integrações mentia dizendo "CONECTADO", e toda chamada de IA do Editor de posts (`resolveWorkspaceKey` corretamente rejeita valores com `•`) caía para a chave global do `.env`, que também é só o placeholder `sk-dummy-...`/`sk-ant-dummy-...` — e explodia com 401 cru da Anthropic (`Falha ao gerar roteiro: 401 {"type":"error",...}`), sem nenhuma orientação ao usuário.

### Correção
- **`backend/prisma/seed.ts`**: nova função `integrationSeed(envKey)` — só marca `CONECTADO` (com a chave real criptografada) quando existe uma chave de verdade no `.env` da plataforma; caso contrário grava `apiKey:null`, `statusLabel:"NÃO CONFIGURADO"`, refletindo o estado real em vez de fingir uma conexão.
- **`shared/ai/keyResolver.ts`**: novas funções `globalKeyUsable(kind)` e `hasUsableKey(workspaceId, kind)` — centralizam a pergunta "existe alguma chave de verdade (global ou do workspace) para este provedor?", reaproveitada em vez de duplicar a checagem que só existia no endpoint `/image`.
- **`carousel.routes.ts`**: `/script`, `/image-prompt` e `/image` agora chamam `hasUsableKey()` **antes** de tentar o provedor e devolvem 422 com mensagem acionável ("cadastre sua chave Anthropic/OpenAI em Configurações → Integrações") em vez de deixar a chamada estourar e vazar o erro cru do provedor num 502.
- Corrigidas à mão as linhas de `integrations` já salvas no banco local (tinham 2 cópias duplicadas de cada provedor, todas com a chave mascarada de seed) para refletirem `NÃO CONFIGURADO`.

### Validado de verdade (Playwright)
1. Sem chave configurada: `POST /carousel/script` → 422 com a mensagem nova, exibida no próprio painel "Gerar roteiro com IA" (antes: 502 com JSON cru da Anthropic).
2. Tela de Integrações passou a mostrar "NÃO CONFIGURADO" para OpenAI e Anthropic (antes mentia "CONECTADO").
3. Cadastrei uma chave sintética (não-real) só para a própria workspace pela tela de Integrações → o Editor de posts voltou a tentar a API real, agora usando a chave do cliente em vez da global (confirmado porque o erro virou 401 **da própria Anthropic** de novo, e não mais o 422 de "não configurado") — prova que o fluxo *bring your own key* por workspace está de fato ligado ao Editor de posts. Removi a chave de teste depois.
4. Salvar projeto, abrir em "Meus carrosséis" e exportar PNG do slide testados ponta a ponta com sucesso (toast "PNG exportado", download real, projeto listado com contagem de slides e hora certas). Projeto de teste removido do banco depois.
5. `npx tsc --noEmit` = 0 erros.

### O que ainda falta para o roteiro/imagem gerarem conteúdo real
Nada de código — só falta uma **chave de verdade** (Anthropic e/ou OpenAI) cadastrada em Configurações → Integrações (ou no `.env` da plataforma). Sem isso, o sistema recusa honestamente em vez de inventar conteúdo, como pedido pelo usuário.

---

## 🆕 SESSÃO 07/10/2026 (parte 5) — LOGO DA MARCA + EXTRAÇÃO AUTOMÁTICA DE PALETA

Pedido: deixar a tela de Marcas no padrão de ferramentas de mercado (Looka, Canva Brand Kit, Genna) — importar a logo e já sair com a paleta de cores, em vez de só aceitar hex digitado à mão.

### O que foi adicionado
- **Upload de logo por marca** (`POST /api/brands/:id/logo`, multipart, PNG/JPG/WEBP/SVG até 4 MB) — arquivo salvo em `storage/brands/<workspaceId>/<brandId>/logo.<ext>`, servido por `GET /api/brands/:id/logo?token=` (mesmo padrão de autenticação via query usado pelos assets de mídia, já que `<img>` não manda header).
- **Extração automática de paleta** (`shared/ai/../media/colorExtract.ts`, biblioteca `sharp`): reamostra a logo, quantiza os pixels em baldes de cor, descarta fundo quase-branco/transparente e devolve até 5 cores dominantes garantindo distância mínima entre elas (evita 5 tons quase iguais). Ao enviar a logo, essas cores **substituem** a lista de `BrandColor` da marca automaticamente — exatamente o fluxo das ferramentas citadas. Formato SVG não passa por extração (não é raster); o upload funciona, só não gera paleta sozinho.
- Editor de marca no frontend ganhou a seção de logo (preview, "Enviar/Trocar logo", remover) acima dos campos de texto; lista de marcas e cabeçalho de detalhe mostram a logo real quando existe, em vez do círculo com a inicial.

### Validado de verdade
Gerei uma imagem de teste (metade `#0F3B63`, metade `#C7873F`) e enviei via API: a resposta trouxe exatamente essas duas cores em `colors`, `paletteExtracted:true`. Confirmei o arquivo servido corretamente (200, `image/png`, dimensões corretas) e bloqueado sem token (401). Repeti pelo navegador (Playwright): upload real pela UI, toast "Logo enviada · cores extraídas automaticamente", campo de cores atualizado ao vivo, preview na lista e no cabeçalho de detalhe — sem erro de console. `npx tsc --noEmit` = 0 erros.

### O que ainda não cobre
- SVG não gera paleta automática (precisaria rasterizar antes — não implementado, baixa prioridade já que logo em SVG costuma vir com as cores da marca já definidas no próprio arquivo de origem).
- Sem edição manual de qual cor é "primária/secundária/destaque" — a paleta extraída entra como uma lista simples, na ordem de dominância.

---

## 🆕 SESSÃO 07/10/2026 (parte 4) — BLOQUEADORES DE PRODUÇÃO

Revisão do trabalho da sessão anterior (verificado código por código, não só a documentação — tenancy, criptografia de credenciais, HMAC do webhook, SSRF do RPA, moduleGuard: tudo bateu). Ambiente subido do zero (volume do Postgres era novo nesta máquina): `prisma db push` + os 3 seeds, `npx tsc --noEmit` = 0 erros, login do cliente demo e do superadmin confirmados via navegador.

### 1. Chave de IA por workspace (pedido explícito: "não quero hardcoded, quero que o cliente adicione a própria")
**Antes:** a tela Integrações/API Keys salvava a chave do cliente criptografada no banco, mas **nada no pipeline de IA lia esse valor** — `ProviderRouter` só construía os providers com `env.OPENAI_API_KEY`/`env.ANTHROPIC_API_KEY` (chave única da plataforma, fixa desde a inicialização do processo). A tela era real no CRUD e inerte na prática — mesmo padrão de outras lacunas já documentadas aqui.

**Agora:** `shared/ai/keyResolver.ts` resolve a chave do workspace (descriptografa a Integração cadastrada; ignora valores mascarados do seed de demonstração) e `ProviderRouter.getProviderForWorkspace(provider, workspaceId)` constrói o client do SDK com essa chave quando ela existe, caindo para a chave global da plataforma (`.env`) quando o workspace não tem a própria. Threadado nos 8 pontos que chamavam o router: as 4 etapas do `OrchestratorService` (campanha), `refineCreativeVersion`, as 2 chamadas de `carousel.service.ts` (roteiro e prompt de imagem) e `aiAnalyze.ts` (agentes operacionais). O método síncrono antigo (`getProvider`, sem workspace) continua existindo para quem não tem o workspace em mãos.

**Validado de verdade, não só por leitura de código:** com `AI_MOCK_MODE=false`, chamei o endpoint real de roteiro do carrossel sem chave própria configurada — a chamada foi até a API real da Anthropic e voltou `401 authentication_error` (prova de que não caiu em mock nem quebrou). Depois troquei a Integração Anthropic do workspace por uma chave de teste (formato válido, não real) via `PATCH /api/integrations/:id` e repeti — mesmo tipo de erro, mas a chamada usou a chave do workspace (confirmado pelo encrypt/decrypt/mask correto no round-trip). Revertido ao placeholder do seed depois do teste.

**Para o cliente usar a própria chave:** Config → API Keys (ou tela Integrações) → editar o provedor OpenAI/Anthropic → colar a chave real. Nenhuma mudança de código necessária — é só cadastrar.

### 2. Segredos próprios (antes: compartilhados no `docker-compose.yml`)
`JWT_SECRET` estava **literal no arquivo versionado** (nem usava variável de ambiente); `CREDENTIALS_KEY` tinha um valor padrão também versionado. Gerados valores novos e únicos para esta instalação (`openssl`-grade random, 48/32 bytes) e gravados só no `.env` local (fora do git). `docker-compose.yml` agora usa `${JWT_SECRET:?...}` e `${CREDENTIALS_KEY:?...}` — **o compose recusa subir sem eles**, então não tem mais como rodar acidentalmente com o segredo antigo. `env.ts` ganhou `JWT_SECRET.min(32)` como trava adicional.

### 3. Backup (antes: nenhum)
`scripts/backup.sh` (`pg_dump -Fc` + `tar` do `backend/storage/`, saída em `backups/<timestamp>/`, retenção automática das últimas 14) e `scripts/restore.sh` (restaura com confirmação explícita). Testado: backup real gerado e validado com `pg_restore -l` (178 entradas na TOC, arquivo íntegro). `backups/` no `.gitignore` — tem dado de cliente, nunca versionar.

### 4. Domínio de produção: `aihub.simplisoft.com.br`
Preparado `docker-compose.prod.yml` + `frontend/Dockerfile.prod` + `frontend/Caddyfile`: Caddy serve o build estático do frontend (`vite build` — testado, gera `dist/` normalmente apesar do motor de template custom) e faz reverse proxy de `/api/*` pro backend, **com HTTPS automático via Let's Encrypt** (não precisa de subdomínio extra nem certbot manual). Postgres/Redis sem porta publicada pro host em produção. **Importante:** isso é só o scaffold — eu não tenho acesso ao servidor `aihub.simplisoft.com.br`; alguém precisa copiar o repo pra lá, apontar o DNS, preencher o `.env` real e rodar `docker compose -f docker-compose.prod.yml up -d --build`. De propósito, o schema do banco **não** é aplicado automaticamente a cada subida em produção (ver comentário no arquivo) — isso evita rodar `--accept-data-loss` sem revisão numa base com dado real.

### 5. Mercado Pago — decisão do usuário: adiado
Sem conta ainda. O fluxo de baixa manual (sem gateway) já cobre cobrança nesse meio-tempo; fica documentado, não bloqueando o resto.

### O que ainda falta dos bloqueadores originais
- Confirmar HTTPS de ponta a ponta rodando de fato em `aihub.simplisoft.com.br` (depende de alguém aplicar o compose de produção no servidor real).
- Gateway Mercado Pago (adiado, por decisão do usuário).
- Rate limit no login/webhooks públicos e observabilidade (logs estruturados persistidos, alerta de fila parada) seguem na lista de "importantes", não mexidos hoje.

---

## 🆕 SESSÃO 07/10/2026 (parte 3) — LOGIN, IDENTIDADE, DIÁLOGOS E EXCLUSÃO DE CONTA

### Identidade da plataforma (white-label)
Nova tabela `platform_settings` (registro único) com nome do produto, assinatura, título e mensagem do login, e-mail de suporte, cor de destaque e logo. O superadmin edita no topo da tela **Plataforma**: envia a logo (PNG/JPG/WEBP/SVG até 2 MB, gravada em `storage/platform/`) e altera os textos.

- `GET /api/platform/branding` e `GET /api/platform/logo` são **públicos** — aparecem antes do login.
- `GET/PUT /api/admin/branding`, `POST/DELETE /api/admin/branding/logo` são do superadmin.
- O nome e a assinatura também passaram a valer no cabeçalho do painel do cliente.

### Tela de login refeita
Logo (ou marca-d'água padrão), nome, assinatura, título e mensagem configuráveis; abas Entrar/Criar conta; **campo de senha com olho para mostrar/ocultar**; Enter envia o formulário; linha de suporte com o e-mail configurado. O botão de conta de demonstração só aparece em `NODE_ENV=development`.

### Diálogos do sistema no lugar dos do navegador
Nenhum `alert`, `confirm` ou `prompt` nativo sobrou (19 ocorrências substituídas). Um único componente cobre os casos:
- confirmação simples, com tom neutro/atenção/perigo;
- formulário com vários campos (texto, e-mail, número, senha com olho, área de texto);
- validação dentro do próprio diálogo (obrigatório, tamanho mínimo, e-mail, número);
- confirmação por digitação do nome exato para ações destrutivas;
- fecha no ESC, no botão Cancelar ou clicando fora.

O card do diálogo carrega `data-dialog="1"` — é o gancho usado pelos testes automatizados.

### Exclusão de conta pelo superadmin
`DELETE /api/admin/accounts/:id` exige o **nome exato da conta** no corpo. Antes de apagar: desagenda os agentes, cancela as publicações programadas e grava a auditoria com o que a conta continha. Depois: remove o workspace (cascata do banco), os usuários que só existiam nela e a pasta de mídia em disco.

### Validação
- `npx tsc --noEmit` = 0 erros.
- Navegador (16 fluxos novos): login com identidade, olho da senha, erro de credencial sem sessão falsa, edição da identidade refletindo no login, diálogos de limite/novo acesso/suspensão/reativação, validação de número e de senha curta, recusa de exclusão com nome errado e exclusão real (o usuário da conta deixa de entrar). **Nenhum diálogo nativo disparado** — o teste falha se algum aparecer.
- Regressões: editor/cobrança 21/21, mover elementos 10/10, superadmin/módulos/agendador 16/16, APIs 31/31 e 25/25, execução real de agente OK.

---

## 🆕 SESSÃO 07/10/2026 (parte 2) — SUPERADMIN, MÓDULOS POR CLIENTE E AGENDADOR

### Como o produto é operado agora
Cada cliente é uma **conta** (workspace). A Simplisoft entra como **superadmin**, cria a conta, entrega o acesso, liga só os módulos contratados, define limites, suspende e reativa a assinatura. O cliente nunca vê a área da plataforma; o superadmin não navega no produto do cliente (ele não pertence a conta nenhuma).

> Observação de arquitetura: o isolamento por conta (`workspaceId` em toda rota) **foi mantido** — é o que separa os dados e já estava testado. A mudança foi de operação: a venda é por conta, com módulos e limites controlados pelo superadmin.

### Módulos contratáveis (`src/shared/modules/catalog.ts`)
`carrossel` (Editor de posts) · `biblioteca` · `marcas` · `campanhas` (estúdio criativo) · `agentes` (Central de Agentes) · `agendador` · `integracoes` · `cobranca`.

O bloqueio vale **na API**, não só no menu: cada grupo de rotas usa `fastify.moduleGuard('<módulo>')`, que responde **403 com mensagem explicando** quando o módulo não faz parte do plano. Esconder o item de menu é consequência, não o controle.

Dashboard, Configurações e o cofre de Credenciais ficam sempre disponíveis (Credenciais aparece quando há algum módulo que usa canal: agentes, agendador ou cobrança).

### Superadmin (`/api/admin`, tela "Plataforma")
| Ação | Efeito real |
|---|---|
| Criar conta | Cria workspace + usuário de acesso (senha provisória), aplica plano, módulos e limites |
| Ligar/desligar módulo | Grava em `workspace.modules`; a API passa a liberar/bloquear na hora |
| Ajustar limites | `maxBrands`, `maxScheduledPosts`, créditos por ciclo |
| Trocar plano | Atualiza a assinatura e o rótulo do plano |
| **Suspender** | Conta em `suspended`: toda rota de dados responde **423** com o motivo, a assinatura vai para `paused` e **os agentes ativos são pausados e desagendados** |
| Reativar | Volta o acesso; os agentes continuam pausados de propósito — quem opera decide o que religar |
| Gestão de acesso | Criar usuário da conta, desativar/reativar (bloqueia login e sessão em curso) e redefinir senha |

Métricas da plataforma: contas, suspensas, usuários ativos, execuções 30d, faturas em aberto e recebido no período.

### Limites por plano
- **Marcas**: `POST /api/brands` recusa com 409 quando a conta atinge `maxBrands` (0 = ilimitado).
- **Agendamentos simultâneos**: `maxScheduledPosts` limita publicações em `scheduled`/`publishing`.
- Planos trazem os padrões: Essencial (1 marca, 30 agendamentos, sem campanhas/agentes), Studio (5 marcas, 150), Scale (ilimitado, 1000).

### Agendador de posts (novo módulo)
- Programa a entrega de uma publicação para data/hora, com título, legenda e até 10 imagens da biblioteca.
- No horário marcado, um **job BullMQ com delay** entrega de verdade no canal escolhido:
  - **Telegram** — `sendPhoto`/`sendMediaGroup` com upload real dos arquivos;
  - **E-mail** — SMTP com as imagens em anexo;
  - **Webhook** — JSON para a automação do cliente (n8n/Make/Zapier), com **links assinados e temporários** (HMAC, 7 dias) para baixar cada imagem sem login.
- Ações: editar/reagendar, publicar agora, cancelar, excluir. Retry automático (3 tentativas, backoff) e reconciliação dos agendamentos quando o serviço sobe.
- Conta suspensa não entrega: a publicação falha com o motivo registrado.
- **A plataforma não publica sozinha em rede social** — ela entrega o conteúdo pronto para quem publica. Isso está escrito na própria tela.

### Correções de comportamento nesta parte
- **Login falho entrava com usuário falso** (resquício do protótipo): a tela mostrava o painel como se a sessão existisse. Agora erro de credencial, acesso desativado ou servidor fora aparecem na tela de login.
- O superadmin não dispara mais chamadas às rotas de cliente (403 em sequência no console).
- O catálogo do agendador é recarregado ao abrir a tela — credencial cadastrada em outro lugar aparece na hora.

### Validação desta parte
- `npx tsc --noEmit` = 0 erros.
- API (31 verificações): bloqueio por módulo em 4 áreas, liberação em tempo real, limite de marcas, criação de conta com acesso, suspensão com motivo e reativação, usuário desativado perdendo sessão e login, agendamento (criação, recusa de data passada, cancelamento, entrega real) e métricas.
- Navegador (16 fluxos): superadmin criando conta com módulos escolhidos, cliente vendo só o contratado, liberação de módulo refletindo após recarregar, agendamento ponta a ponta, aviso de conta suspensa, reativação e regressão da conta demo.
- Regressões: editor/cobrança 21/21, mover elementos 10/10, agentes 25/25 + execução real de agente.

### Acessos de teste
- **Superadmin:** `admin@simplisoft.com.br` / `simplisoft123` (configurável por `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`; rode `npx tsx prisma/seed-superadmin.ts`).
- **Cliente demo:** `vidal@simplisoft.com.br` / `123456` (todos os módulos ligados).

---

## 🚧 O QUE AINDA FALTA PARA PRODUÇÃO (lista consolidada)

**Bloqueadores (antes do primeiro cliente pagante)** — atualizado na sessão 07/10 (parte 4)
1. ✅ **Chaves de IA** — deixou de ser "configurar uma chave global": agora cada workspace pode trazer a própria (Config → API Keys), e o pipeline realmente usa essa chave quando existe (`ProviderRouter.getProviderForWorkspace`, ver seção dedicada acima). `AI_MOCK_MODE=false` já ligado nesta instalação. Falta só colar a chave real do cliente na Integração (sem mudança de código).
2. ✅ **`CREDENTIALS_KEY` própria e `JWT_SECRET` fora do código** — gerados, únicos por instalação, só no `.env` local; `docker-compose.yml` recusa subir sem eles.
3. 🟡 **HTTPS + domínio + `PUBLIC_API_URL`** — domínio definido (`aihub.simplisoft.com.br`), scaffold pronto (`docker-compose.prod.yml` + Caddy com HTTPS automático). Falta alguém rodar isso no servidor real — não foi (e não podia ser) testado ponta a ponta daqui.
4. ✅ **Backup do Postgres e do `storage/`** — `scripts/backup.sh` / `restore.sh`, testado.
5. ⏸️ **Gateway de pagamento** — adiado por decisão do usuário (sem conta Mercado Pago ainda); baixa manual cobre o meio-tempo.

**Importantes (primeiras semanas)**
6. Fechamento de ciclo automático (hoje é botão; falta o job mensal).
7. Assinatura recorrente no gateway (`preapproval`) em vez de fatura a fatura.
8. Recuperação de senha pelo próprio usuário (hoje só o superadmin redefine).
9. Limite de taxa (rate limit) no login e nos webhooks públicos.
10. Observabilidade: logs estruturados persistidos, alerta quando a fila para ou o worker cai.
11. Testes automatizados no repositório (hoje as suítes vivem fora do projeto). ✅ `docker compose` de produção separado do de desenvolvimento já existe (`docker-compose.prod.yml`, ver item 3).

**Desejáveis**
12. Publicação direta em redes sociais (Instagram/LinkedIn) via API oficial, hoje coberta pelo canal Webhook.
13. MCP e provedores de execução alternativos (Cowork/Claude Code) — a interface existe, falta implementação.
14. Edição colaborativa e histórico de versões do carrossel; formatos 1:1 e 16:9.
15. Relatórios por cliente (uso, ROI, custo) exportáveis em PDF.

---

## 🆕 SESSÃO 07/10/2026 — EDITOR DE POSTS (CARROSSEL) + MÓDULO DE COBRANÇA

Referências analisadas: `exemplo/Carrossel Studio v2.dc.html` (editor) e `exemplo/Carrossel Studio Plataforma.dc.html` (shell com a tela de Cobranças). As duas usam o mesmo motor de template do projeto (`support.js`), então a renderização do canvas foi portada e adaptada; o que era local/demonstrativo virou funcionalidade real com backend, multi-tenant e auditoria.

### Diferença em relação às referências
| Referência | Aqui |
|---|---|
| Projetos e biblioteca em `localStorage`/IndexedDB do navegador | `carousel_projects` e `media_assets` no Postgres, isolados por workspace |
| `window.claude.complete()` (runtime do protótipo) | Nosso `ProviderRouter` (Claude/OpenAI) com registro de consumo em `usage_records` |
| “Imagens geradas” por gradiente desenhado no canvas | Geração real via OpenAI quando há chave; sem chave, a API recusa e orienta a gerar fora e importar |
| Cobrança com planos, cartão e faturas de demonstração | Assinatura, ciclo e faturas calculados do consumo real + gateway Mercado Pago de verdade |

### Editor de posts (`/carrossel`)
- **Canvas 1080×1350** com 9 tipos de slide (capa, texto, dado, citação, foto, CTA, checklist, antes/depois, caso), 5 temas, 4 fontes e cor de destaque. Texto entre `*asteriscos*` recebe a cor de destaque.
- **Roteiro com IA**: `POST /api/carousel/script` monta o deck a partir do tema, do brand kit cadastrado (setor, público, tom, palavras proibidas) e devolve os slides. Em `AI_MOCK_MODE=true` devolve a **estrutura** com aviso explícito de simulação — nunca um texto inventado passando por real.
- **Imagens**: importar arquivo (upload real, `@fastify/multipart`), reusar da biblioteca do workspace, escrever prompt com IA ou gerar imagem. Os arquivos ficam em `backend/storage/media/<workspaceId>/` e são servidos por `GET /api/media/:id/file?token=` (o `<img>` não envia header, mesmo padrão do SSE) com checagem de tenant.
- **Edição**: painel com os campos do tipo de slide, tira de slides com reordenar/duplicar/excluir, desfazer/refazer, zoom.
- **Edição no canvas e mover elementos** (como na v2 de referência): o botão alterna entre **✎ Editar texto** — escrever direto na peça, preservando os destaques `*asterisco*` — e **✥ Mover elementos** — arrastar título, texto, lista, número, citação, CTA, avatar, imagem e o bloco antes/depois; `⌖` restaura as posições do slide. O deslocamento é dividido pelo zoom para o bloco acompanhar o cursor, fica salvo em `slide.pos` e entra no PNG exportado. A foto também é reenquadrada arrastando (grava `imgX`/`imgY`).
  - Dois detalhes que custaram bug: o bloco editável **não pode ter filhos gerenciados pelo React** (contentEditable + reconciliação = `removeChild`), por isso os destaques vão como HTML pronto e são lidos de volta no blur; e o véu escuro sobre a imagem precisa de `pointer-events:none`, senão intercepta o arraste de enquadramento.
- **Exportação**: PNG do slide, ZIP do carrossel (html-to-image + JSZip, no navegador) e “Salvar na Biblioteca”, que sobe cada peça como `media_asset` e a faz aparecer na tela Biblioteca.
- **Projetos**: salvar/abrir/excluir carrosséis do workspace (`/api/carousel`).

### Módulo de cobrança (`/cobranca`)
- **Planos** (`plans`, seed em `prisma/seed-plans.ts`): Essencial/Studio/Scale com preço, créditos inclusos e preço do crédito excedente — todos editáveis na tabela.
- **Assinatura e ciclo** (`subscriptions`): cada workspace tem período corrente; trocar de plano atualiza o painel e o limite de créditos.
- **Fatura do ciclo** (`invoices`): `POST /api/billing/close-cycle` soma a mensalidade com os **créditos excedentes medidos de verdade** (execuções de agentes, tokens e tempo de navegador contabilizados em `usage_records`), zera o contador e abre o próximo período. Fechar antes do fim do ciclo exige confirmação.
- **Pagamento (Mercado Pago)**: `POST /api/billing/invoices/:id/checkout` cria a order do Checkout Pro (`POST /v1/orders`, `X-Idempotency-Key`) e guarda o `checkout_url`. A confirmação chega por `POST /api/hooks/payments/mercadopago/:workspaceId`, com **validação HMAC do header `x-signature`**; mesmo assim o pagamento só é marcado após consultar a order na API — o corpo da notificação nunca é tratado como verdade. Há também “Conferir pagamento”, que consulta o gateway sob demanda.
- **Sem gateway conectado**: a tela diz isso com todas as letras e oferece **baixa manual** (PIX/boleto/transferência fora do sistema), registrada com responsável e observação na auditoria.
- A credencial do gateway (`accessToken`, `webhookSecret`) fica no mesmo cofre criptografado das demais, no tipo **“Mercado Pago (cobrança)”**.

### Como conectar a cobrança de verdade
1. Em **Credenciais → Nova credencial → Mercado Pago (cobrança)**, informe o *Access Token* (produção ou teste) e o *webhookSecret*.
2. No painel do Mercado Pago, cadastre a URL de notificação mostrada na tela de Cobrança (`PUBLIC_API_URL` + `/api/hooks/payments/mercadopago/<workspaceId>`). Em desenvolvimento, exponha a porta 3000 por um túnel e ajuste `PUBLIC_API_URL`.
3. Gere a fatura e use **Gerar pagamento**.

### Mudanças de infraestrutura
- `docker-compose.yml`: Postgres passou a publicar **5433** e Redis **6380** no host. Outro projeto desta máquina (`maestro-db`) já ocupava a 5432 e isso derrubou a rede do nosso container do Postgres. Dentro da rede do compose nada muda (`postgres:5432`, `redis:6379`).
- Novas tabelas: `media_assets`, `carousel_projects`, `plans`, `subscriptions`, `invoices`, `payment_events`.
- `@fastify/multipart` registrado (10 MB por arquivo).
- As fontes do Google passaram a ser carregadas com `crossorigin="anonymous"` — sem isso o `html-to-image` não consegue ler as regras e o PNG exportado sairia com fonte de fallback.

### Validação desta sessão
- `npx tsc --noEmit` = 0 erros.
- API (25 verificações, todas OK): roteiro com aviso de simulação, CRUD e duplicação de carrossel, upload e proteção do arquivo por token, troca de plano, recusa de fechamento antecipado do ciclo, fatura com valor correto, checkout sem gateway com mensagem orientando, baixa manual, bloqueio de pagamento duplicado, webhook sem credencial recusado e isolamento entre dois tenants (carrosséis, faturas e mídia).
- Navegador (21 fluxos, todos OK): abrir editor, aplicar estrutura, editar texto refletindo no canvas, trocar tema, navegar/reordenar/duplicar/excluir slides, desfazer, gerar roteiro, salvar projeto, **baixar o PNG**, exportar as peças para a Biblioteca, usar imagem da biblioteca, abrir cobrança, trocar plano, fechar ciclo, dar baixa manual, aviso de gateway ausente e **regressão da Central de Agentes**. Sem erros de console; sem estouro de largura em 400 px.

### O que ainda NÃO está implementado
- Assinatura recorrente automática no gateway (hoje a cobrança é por fatura; `preapproval` do Mercado Pago não foi integrado).
- Fechamento de ciclo automático por agendador (existe o botão e a API; falta o job mensal).
- Vídeo nos slides e formatos 1:1 / 16:9 (só 4:5 por enquanto).
- Nota fiscal e régua de cobrança (e-mail de aviso de vencimento).

---

## 🆕 SESSÃO 19/09/2026 — AGENT OPERATIONS CENTER (piloto de orquestração + RPA)

Base: `01_Mapa_Mental_Simplisoft_AI_Orchestration (1).md` e `02_Diretrizes_RPA_Claude_Piloto.md`. Incremental — nada do estúdio criativo foi removido.

### Ideia central implementada
O cliente configura um **agente operacional**, dá a ele ferramentas e regras, define quando ele trabalha e recebe o resultado — com supervisão humana e trilha completa.

Dois tipos de agente convivem na mesma tabela (`Agent.kind`):
- `STUDIO` — os agentes descritivos da esteira criativa (como antes).
- `OPERATIONAL` — executam um **playbook** (lista de etapas) via Tool Gateway.

### Correções estruturais encontradas na análise (bloqueavam o piloto)
| Problema | Correção |
|---|---|
| **Sem isolamento de tenant**: todas as rotas usavam `prisma.workspace.findFirst()` e as listagens não filtravam por workspace | `shared/tenancy/tenant.ts` + `fastify.tenantGuard` (JWT + membership). Todas as rotas filtram por `workspaceId` da sessão; `workspaceId` enviado no corpo é ignorado. |
| `AI_MOCK_MODE=false` nunca desligava o mock (`z.coerce.boolean("false") === true`) | Parser booleano explícito em `config/env.ts`. |
| Chave de API de integração gravada/devolvida em texto puro | Criptografada (`enc:` + AES-256-GCM) e devolvida mascarada. |
| SSE `/campaigns/:id/stream` sem autenticação | JWT via `?token=` + verificação de posse da campanha. |
| Worker BullMQ nunca era iniciado | `server.ts` sobe o worker de agentes quando `RUN_WORKERS=true`. |
| `AnthropicProvider` enviava `temperature` (Claude Opus 5/Sonnet 5 recusam com 400) e usava modelo antigo | `shared/ai/models.ts` mapeia rótulos da UI → IDs reais (`claude-opus-5`, `claude-sonnet-5`…) e preço; `temperature` só vai para modelos que aceitam. |

### Arquitetura nova (`backend/src/agent-ops/`)
```
Agente (playbook) → fila BullMQ (agent-executions) → worker → engine.ts
      → ExecutionProvider (providers/: hoje "native"; Cowork/Claude Code entram aqui)
      → ToolGateway (gateway.ts): ferramenta liberada? política de autonomia? credencial do tenant? limite de ações?
      → Ferramentas (tools/): http.request · browser.playwright · sandbox.dataset · data.metrics · ai.analyze · telegram.send · email.send · webhook.send
      → AgentExecution + AgentExecutionLog (linha do tempo) + ApprovalRequest + UsageRecord + AuditLog
```
- **Nunca executa dentro da requisição HTTP**: rotas criam a execução e respondem `202`.
- **Falhas**: `errors.ts` separa *recuperável* (rede, timeout, 5xx/429 → retry com backoff) de *intervenção* (credencial, CAPTCHA, configuração → falha + alerta) e *política* (domínio, ferramenta, ação destrutiva). O estado é salvo a cada etapa — retry e aprovação retomam de onde parou.
- **Autonomia** (`READ_ONLY`, `RECOMMEND`, `REQUIRE_APPROVAL` padrão, `CONTROLLED_AUTONOMY`): ferramentas se classificam em `read` / `notify` / `write`; o gateway decide executar, pular (vira recomendação), pedir aprovação ou simular.
- **Teste = sandbox**: coleta e analisa de verdade, mas nada com efeito externo é executado (aparece como "simulada"). **Ativação exige teste bem-sucedido**; mudar playbook/ferramentas/modelo/autonomia de um agente ativo o pausa até novo teste.
- **Segurança de rede**: allowlist de domínios por agente, redirects revalidados, bloqueio de rede privada (evita alcançar Postgres/Redis/API — `ALLOW_PRIVATE_NETWORK=false`).
- **Prompt injection**: `ai.analyze` isola dados externos em `<dados_nao_confiaveis>` (delimitador neutralizado) com guardrail; políticas vêm sempre do banco, nunca do conteúdo.
- **Credenciais**: tabela `credentials`, AES-256-GCM com `CREDENTIALS_KEY`; a API só devolve metadados mascarados; logs passam por `redact()`. Sessão persistente do navegador fica criptografada como credencial interna `browser-session:<agentId>`.
- **RPA**: Playwright com Chromium na imagem (`WITH_BROWSER=true` no compose). Bloqueia navegação fora da allowlist, cliques em botões destrutivos (sem `mutates:true`) e detecta CAPTCHA.
- **Agenda**: manual, diário/semanal (horário + dias), mensal, cron, webhook (`POST /api/hooks/agents/:token`). `upsertJobScheduler` do BullMQ, fuso `America/Sao_Paulo`, reconciliado na subida.
- **Consumo auditável**: tokens, custo estimado por modelo, ações e tempo de navegador por execução (`UsageRecord.metadata`); créditos provisórios = 1/execução + 1/1.000 tokens + 1/min de navegador (`engine.ts:creditsFor`).
- **ROI**: `Agent.estimatedMinutesSaved` × execuções concluídas → "horas economizadas" no dashboard.

### Rotas novas
| Rota | Função |
|---|---|
| `GET /api/agents/catalog` | ferramentas, templates do piloto, provedores, níveis de autonomia |
| `GET /api/agents/:id` | detalhe + estatísticas 30d + execuções + custo por dia |
| `POST /api/agents/:id/test` · `/run` · `/activate` · `/pause` · `/webhook-token` | ciclo de vida |
| `GET /api/executions` · `GET /:id` · `POST /:id/cancel` | execuções e linha do tempo |
| `GET /api/approvals` · `POST /:id/approve` (com `editedInput`) · `POST /:id/reject` | aprovação humana (decisão atômica) |
| `GET/POST/PATCH/DELETE /api/credentials` · `POST /:id/test` · `GET /types` | cofre de credenciais |
| `GET /api/operations/summary` | indicadores da Central de Agentes |
| `GET /api/audit` | trilha de auditoria |
| `POST /api/hooks/agents/:token` | gatilho externo (público, token secreto) |

### Frontend
- **Dashboard**: bloco "Central de Agentes" (agentes ativos, execuções hoje, concluídas, com erro, aguardando aprovação, horas economizadas), gráfico de 7 dias, "Precisa de atenção" e gestão do mês. Saudação/data agora dinâmicas.
- **Agentes de IA**: seção de agentes operacionais (status, autonomia, última/próxima execução, sucesso 30d) + equipe do estúdio.
- **Detalhe do agente**: abas Visão geral, Instruções, Ferramentas & etapas, Agendamento, Permissões, Execuções, Custos.
- **Wizard de 9 etapas** (§21): nome/objetivo → especialidade/template → ferramentas → fontes de dados (playbook JSON + allowlist) → agenda → permissões → canal de saída → teste sandbox → ativar.
- **Execuções**, **Linha do tempo da execução**, **Aprovações** (Aprovar / Editar e aprovar / Rejeitar), **Credenciais**, auditoria real em Configurações › Segurança.
- Correção de layout pré-existente: grades estouravam a largura em celular (400px) — agora `minmax(0,1fr)`.

### Templates do piloto (`agent-ops/templates.ts`)
- **Analista de Produtividade Comercial** (§16): coleta → indicadores por vendedor → análise → Telegram. Vem com `sandbox.dataset` (dados de exemplo **rotulados como tal**) para testar antes de conectar o CRM real; trocar a etapa "coletar" por `http.request` ou `browser.playwright`.
- **Analista de Marketing** (§18): métricas → desempenho por formato → diagnóstico/calendário/briefings → envio ao sistema de publicação **sempre com aprovação**.

### Como subir após esta sessão
```powershell
docker compose up -d -V --build          # -V renova o node_modules anônimo (deps novas: nodemailer, cron-parser, playwright)
docker exec ai_creative_backend npx prisma db push --skip-generate
docker exec ai_creative_backend npx tsx prisma/seed.ts   # só em banco vazio (seed não é idempotente para marcas/agentes)
```
Variáveis novas (ver `.env.example`): `CREDENTIALS_KEY` (obrigatória em produção — sem ela as credenciais não abrem), `RUN_WORKERS`, `ALLOW_PRIVATE_NETWORK`. O compose define uma `CREDENTIALS_KEY` de desenvolvimento — **troque em qualquer ambiente real**. A imagem do backend passou de `node:20-alpine` para `node:20-bookworm-slim` (Chromium do Playwright não roda em Alpine).

### Validação feita (real, não leitura de código)
- `npx tsc --noEmit` = 0 erros.
- Suíte de API (30 verificações, todas OK): criação em rascunho, ativação bloqueada sem teste, teste em sandbox com entrega simulada, ativação com agenda, execução real (chamada real à API do Telegram com token falso → falha registrada e execução segue por `onError: continue`), pausa para aprovação, rejeição retomando a execução, decisão duplicada recusada, SSRF para `postgres` bloqueado, domínio fora da allowlist bloqueado, ferramenta não liberada recusada, isolamento completo entre dois tenants (agentes, execuções, credenciais, campanhas), painel, auditoria, webhook.
- RPA real: Chromium abriu `example.com` autorizado e extraiu dados; navegação para `iana.org` bloqueada por política.
- UI com Playwright (12 fluxos): login, lista, wizard completo com teste e ativação, abas, executar agora com linha do tempo, execuções, aprovações, credenciais (segredo não aparece na página), auditoria e **regressão do fluxo criativo** (campanha criada até o resultado).

### ⚠️ Banco de desenvolvimento
Ao subir o ambiente nesta sessão, o volume `orquestrador-ia_postgres_data` **não existia** e foi criado vazio (criado em 19/09 17:30 UTC pelo `docker compose up`; `-V` não recria volume nomeado). O banco foi semeado de novo. Os testes deixaram dados de teste no workspace Simplisoft (agentes "Analista Comercial NNNNN", credenciais de teste) e um usuário `outroNNNNN@teste.com`.

### O que ainda NÃO está implementado (honesto)
- Análise real por IA depende de `ANTHROPIC_API_KEY` válida + `AI_MOCK_MODE=false`; em mock, `ai.analyze` devolve um texto explicitamente marcado como **simulado** (nunca uma análise inventada).
- Ferramenta MCP (`mcp.tool`) e provedores Cowork/Claude Code: a interface `ExecutionProvider` está pronta, sem implementação.
- Editor visual de workflow e encadeamento entre agentes (o playbook já é a base).
- Gestão de membros/papéis por workspace na UI (a API já respeita OWNER/ADMIN no PATCH de workspace).
- Capturas de tela do RPA são salvas em `backend/storage/executions/<id>/`, mas ainda não são exibidas na UI.
- Credenciais OAuth sem renovação automática de token.

---

## 1. 📌 VISÃO GERAL DO PROJETO
O **AI Creative Studio** é uma plataforma SaaS Full-Stack para orquestração de múltiplos agentes de Inteligência Artificial (OpenAI GPT-4o, Anthropic Claude Sonnet 4, DeepSeek, DALL-E/GPT Image, etc.), focada na geração automatizada de campanhas de marketing, estratégias, copies, direção de arte e análise de peças visuais.

Composto por:
- **Backend Node.js/TypeScript (Fastify)** com rotas REST e streaming de eventos em tempo real via Server-Sent Events (SSE).
- **Banco de Dados Relacional (PostgreSQL + Prisma ORM)** com schema de usuários, workspaces, membros, marcas (brand kits), agentes de IA, integrações, campanhas, execuções e peças de mídia.
- **Processamento Assíncrono (Redis + BullMQ)** — infraestrutura presente; hoje o disparo automático via fila foi removido do fluxo de criação de campanha para não duplicar a execução do workflow (ver seção 5-B). Fica disponível para uso futuro (ex: processamento em lote sem SSE).
- **Frontend SPA Reativo (HTML5 + Custom Engine `dc-runtime`/React 18)** com Hot Reload real em container Docker (polling ativado — ver seção 5-E).

---

## 2. 🛠️ ARQUITETURA & STACK TECNOLÓGICA

### 🐳 Docker & Ambiente de Desenvolvimento (Regra de Ouro)
O projeto roda em containers Docker orquestrados por `docker-compose.yml`:
- **`ai_creative_postgres`**: PostgreSQL 16 (Porta `5432:5432`)
- **`ai_creative_redis`**: Redis 7 (Porta `6379:6379`)
- **`ai_creative_backend`**: Fastify + TypeScript + Prisma (Porta `3000:3000`)
- **`ai_creative_frontend`**: Servidor Web Vite / HTML (Porta `8080:8080`)

**Hot Reload de Código Local (Volumes Mapeados):**
- `./backend:/app` com volume anônimo `/app/node_modules`
- `./frontend:/app` com volume anônimo `/app/node_modules`
- **`CHOKIDAR_USEPOLLING=true`** em ambos os serviços (adicionado nesta sessão) — sem isso, o `tsx watch` e o Vite dev server **não detectavam mudanças de arquivo** neste ambiente Windows/Docker Desktop, exigindo `docker restart` manual a cada edição. Com polling, o hot reload funciona de verdade.

---

## 3. 🗺️ MAPEAMENTO DAS VIEWS

A interface do frontend ([`frontend/index.html`](file:///d:/SIMPLISOFT/orquestrador-ia/frontend/index.html)) contém 10 views e 4 modais/drawers controlados por estado reativo:

| Rota / ID | Nome da Tela | Estado real (pós-correção) |
| :--- | :--- | :--- |
| `dashboard` | **Dashboard** | Contadores, créditos e criações recentes vêm de dados reais do banco. Card de créditos fica laranja e mostra aviso quando o consumo passa do `creditsAlertPct` configurado. |
| `criar` | **Criar Nova Campanha** | Formulário real; marca e formato padrão vêm do workspace/brands reais. |
| `workflow` | **Esteira de Produção (SSE)** | Progresso real via SSE, ligado ao `OrchestratorService`. |
| `resultado` | **Resultado da Campanha** | Copy, estratégia, direção, imagens, scores e crítica vêm da `CreativeVersion` real gerada. Aba **Refinamento** chama o endpoint real de refino e atualiza a tela. |
| `projetos` / `campanhas` / `templates` | **Projetos & Campanhas** | Lista campanhas reais do banco, com filtro por status. |
| `biblioteca` | **Biblioteca de Mídias** | Itens vêm das versões de criativos reais já geradas. |
| `marcas` | **Marcas & Brand Kits** | CRUD completo real (criar, editar, excluir), incluindo cores/produtos/serviços. |
| `agentes` | **Agentes de IA** | CRUD completo real (criar, editar, pausar, excluir), persistido no Postgres. |
| `integracoes` | **Provedores & Integrações** | CRUD completo real. |
| `config` | **Configurações do Sistema** | Ver seção 5-D — parcialmente real, parcialmente honesto-sobre-não-implementado (não fake). |

---

## 4. 🔐 SISTEMA DE AUTENTICAÇÃO E SEGURANÇA (JWT)

1. **Estado Deslogado:** interface do painel oculta, tela cheia de auth, botão "⚡ Usar Conta Demo (Vidal Costa)".
2. **Endpoints (`backend/src/modules/auth/auth.routes.ts`):**
   - `POST /api/auth/login`, `POST /api/auth/register`, `GET /api/auth/me`
   - **`PATCH /api/auth/me`** *(novo)* — atualiza `name` e `jobTitle` do usuário logado.
3. **Logout:** `apiClient.logout()` limpa o token do `localStorage`, `setState({user:null, drawer:null})`, volta pra tela de login. **Estava quebrado até esta sessão** — ver seção 5-C.

---

## 5. 🐛 CORREÇÕES DESTA SESSÃO (mock → real)

### A. 🔴 CRÍTICO — `window.apiClient` nunca existia (proxy do Vite quebrado)
- **Problema:** `vite.config.js` tinha a regra de proxy `'/api'` (sem barra final). Como `http-proxy-middleware` faz *match por prefixo de string*, `/apiClient.js` (o módulo do cliente HTTP) também batia nesse prefixo (`"/apiClient.js".startsWith("/api")` → `true`) e era redirecionado pro backend, que respondia 404 pra essa rota. O `import` do módulo falhava, `window.apiClient` nunca era atribuído, e **todo o app** (login, CRUD de agentes/integrações/marcas, criação de campanha) caía silenciosamente nos fallbacks locais escritos "pra não quebrar a demo". Por fora parecia 100% funcional.
- **Solução:** trocada a regra para `'/api/'` (com barra) em [`frontend/vite.config.js`](file:///d:/SIMPLISOFT/orquestrador-ia/frontend/vite.config.js).
- **Como confirmar que não voltou:** `curl http://localhost:8080/apiClient.js` deve devolver o JS do arquivo (200), não um JSON de erro do backend.

### B. 🔴 CRÍTICO — Classificação de prompts do `MockAIProvider` por palavra solta
- **Problema:** `backend/src/shared/ai/providers/MockAIProvider.ts` decidia qual resposta mock devolver checando se o prompt continha palavras genéricas (`'Estratégia'`, `'Copy'`, `'Direção'`...). O prompt do Copywriter tem "Estratégia:" como cabeçalho de seção, então ele recebia de volta os dados do Estrategista (sem `headline`) — e o passo de finalização quebrava com `Cannot read properties of undefined (reading 'slice')`. **Toda campanha falhava silenciosamente no último passo**, e como nada era persistido, a tela de resultado sempre mostrava os textos estáticos de exemplo — reforçando a ilusão de que estava tudo certo.
- **Solução:** classificação trocada pra usar os marcadores fixos e únicos de cada agente (`ESTRATEGISTA`, `COPYWRITER`, `DIRETOR DE ARTE`, `CRÍTICO`) em vez de palavras genéricas que podem aparecer em texto livre do usuário. O mesmo bug reapareceu no fluxo de **refinamento** (prompt sem cabeçalho de agente) e foi corrigido apontando pro marcador fixo do próprio template (`"Solicitação de Alteração:"`) — não uma palavra solta, pra não colidir com o texto livre digitado pelo usuário no campo de refinamento.
- Também foi removida a **execução dupla do workflow**: `POST /api/campaigns` enfileirava um job no BullMQ *e* o frontend abria a SSE (`GET /:id/stream`), que também chamava `executeCampaignWorkflow` diretamente — cada campanha rodava o pipeline de IA duas vezes, gerando duas `Creative`/`CreativeVersion`. O `campaignQueue.add(...)` foi removido da rota de criação; a fila BullMQ continua disponível para uso futuro.

### C. Logout não funcionava (bug diferente do documentado anteriormente — esse era outro)
- **Problema real (não era mais o `artes[s.drawer]` documentado na versão anterior deste doc, que já tinha sido corrigido):** o drawer do menu do usuário usava `sc-if value="{{ drawer === 'userMenu' }}"` — uma expressão JS inline dentro de `{{ }}`. O motor de template (`compileAttr` em `support.js`) só resolve *lookups de propriedade simples*, nunca expressões — então esse `sc-if` nunca era verdadeiro e **o menu nunca abria**. Além disso, o painel interno usava `onClick="(e)=>e.stopPropagation()"` como string inline, que também não é suportado (vira string literal, React rejeita com "Expected onClick listener to be a function").
- **Solução:** adicionada prop calculada `userMenuOpen: s.drawer === "userMenu"` em `renderVals()`, e o painel reestruturado com backdrop absoluto separado (mesmo padrão já usado no editor de agentes/integrações), sem precisar de `stopPropagation`.

### D. Configurações — real onde dava, honesto onde não dava
Implementado com efeito real e testado (não é só um valor salvo que ninguém lê):
- **Perfil:** nome e cargo editáveis (`PATCH /api/auth/me`).
- **Workspace:** nome editável (`PATCH /api/workspaces/:id`, rota nova), membros/marcas com contagem real (`_count` do Prisma).
- **Preferências:** tema, **formato padrão** (pré-preenche o form de Criar), **variações por geração** (1–4, controla de verdade quantas imagens o `OrchestratorService` gera — testado: setar 2 gerou 2 imagens), **autoavaliação** (liga/desliga o passo do agente Crítico no orquestrador).
- **Limites de uso:** créditos por ciclo editável; **alerta de consumo** tem efeito visível real (card de créditos fica laranja no dashboard ao passar do %).
- **API Keys:** parou de mostrar 4 chaves fake — reaproveita os dados reais da tela Integrações.
- **Billing / Notificações / Segurança:** **deixados honestos, não fake.** Não há processador de pagamento, envio de e-mail ou 2FA/SSO/log de auditoria implementados no projeto. Fingir esses controles funcionando seria pior que não ter — principalmente Segurança, onde um toggle de 2FA que não protege nada dá falsa sensação de proteção. Essas telas mostram só dado real (plano, sessão atual) e uma mensagem clara de "ainda não implementado".
- **Modelos de IA:** deixado como informativo (modelo fixo por etapa, definido no código). Trocar o modelo por etapa não teria efeito visível nenhum enquanto `AI_MOCK_MODE=true`, porque o `MockAIProvider` ignora qual provider foi solicitado e responde por palavra-chave do prompt. Só passa a valer a pena implementar quando houver chave real de API conectada.

### E. Hot reload não funcionava de verdade
- `tsx watch` (backend) e o Vite dev server (frontend) não detectavam mudanças de arquivo neste ambiente — exigia `docker restart` manual. Corrigido com `CHOKIDAR_USEPOLLING=true` nos dois serviços do `docker-compose.yml` (ver seção 2).

---

## 6. 🗄️ MUDANÇAS DE SCHEMA (Prisma) NESTA SESSÃO

Aplicadas via `prisma db push` (sem perda de dado do seed):
- `Integration.provider`: enum fixo `IntegrationProvider` → `String` livre (a UI sempre permitiu provedor customizado; o enum travava criação de integrações não previstas).
- `Agent.type`: ganhou `@default(STRATEGIST)` (a UI de criação de agente não pede tipo).
- `User.jobTitle`: novo campo opcional (aba Perfil).
- `Workspace`: novos campos `defaultFormat`, `defaultVariationCount`, `autoReview`, `creditsAlertPct` (aba Preferências / Limites de uso).

---

## 7. 🔌 ROTAS REST ADICIONADAS NESTA SESSÃO

| Método | Rota | O que faz |
| :--- | :--- | :--- |
| `PATCH` | `/api/agents/:id` | Atualiza agente (inclui pausar/ativar) |
| `DELETE` | `/api/agents/:id` | Exclui agente |
| `POST` | `/api/integrations` | Cria integração/provedor |
| `PATCH` | `/api/integrations/:id` | Atualiza integração |
| `DELETE` | `/api/integrations/:id` | Exclui integração |
| `PATCH` | `/api/brands/:id` | Atualiza marca (nome, setor, cores, produtos, serviços, palavras) |
| `DELETE` | `/api/brands/:id` | Exclui marca |
| `PATCH` | `/api/auth/me` | Atualiza perfil (nome, cargo) |
| `PATCH` | `/api/workspaces/:id` | Atualiza workspace (nome, preferências, créditos) |

`POST /api/brands` e `POST /api/integrations` também passaram a aceitar os campos completos (cores/produtos/serviços; provider livre).

---

## 8. 🧪 VALIDAÇÃO E COMANDOS DE VERIFICAÇÃO

1. **Checagem de Tipagem TypeScript (Backend):**
   ```powershell
   cd d:\SIMPLISOFT\orquestrador-ia\backend
   npx tsc --noEmit
   ```
   *Saída esperada:* `0 erros` (Exit code 0). — confirmado ao final desta sessão.

2. **Subir / Reiniciar Serviços no Docker:**
   ```powershell
   cd d:\SIMPLISOFT\orquestrador-ia
   docker compose up -d
   ```

3. **Testar a conexão real (depois de qualquer mudança no proxy/apiClient):**
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/apiClient.js
   ```
   Deve retornar `200`. Se voltar `404`, o bug da seção 5-A voltou.

4. **Credenciais Padrão de Teste (Seed):**
   - **E-mail:** `vidal@simplisoft.com.br`
   - **Senha:** `123456`
   - **URL Frontend:** `http://localhost:8080`
   - **URL Backend REST:** `http://localhost:3000/api`

5. **Validação feita nesta sessão:** fluxo completo testado com Playwright real (não só leitura de código) — login, CRUD de agentes/integrações/marcas via UI, criação de campanha do zero até resultado com dados reais nas 4 abas, refinamento gerando V2 real, logout. Sem erros de console.

---

## 9. 📝 O QUE FALTA (conhecido, não implementado — não é bug escondido)

- **Billing:** sem processador de pagamento (Stripe ou similar) integrado.
- **Notificações:** preferências não têm mecanismo de envio (nenhum serviço de e-mail/push conectado).
- **Segurança:** sem 2FA, SSO ou log de auditoria reais.
- **Modelos de IA por etapa:** seleção de modelo não é editável — é fixa no código do orquestrador. Só faz sentido implementar com uma chave de API real conectada (`AI_MOCK_MODE=false`).
- **"Gerar 4 variações"** (aba Refinamento): mostra aviso de indisponível — regenerar imagens exigiria uma nova chamada de geração, que o endpoint de refino atual não faz (ele só regenera copy).
- **Exportar / Entregar campanha:** sem funcionalidade real por trás ainda.

---

## 10. 📝 CHECKLIST DE INSTRUÇÕES PARA O PRÓXIMO AGENTE / SESSÃO

- [ ] **Antes de mexer no proxy do Vite**, releia a seção 5-A. Qualquer regra de proxy nova deve terminar em `/` se for um prefixo de path (ex: `/api/`, não `/api`).
- [ ] **Antes de adicionar uma nova palavra-chave ao `MockAIProvider`**, releia a seção 5-B — use marcadores fixos do próprio prompt (ex: um cabeçalho de agente), nunca uma palavra que possa aparecer em texto livre do usuário (briefing, prompt de refinamento).
- [ ] **`sc-if value="{{ ... }}"` só aceita lookup de propriedade simples** — nunca uma expressão JS (`===`, ternário, etc.). Sempre compute a prop booleana em `renderVals()` antes.
- [ ] **`onClick` inline também só aceita `{{ prop }}`** — nunca uma função escrita direto no atributo (`onClick="(e)=>..."`). Use o padrão de backdrop absoluto + painel relativo pra evitar precisar de `stopPropagation`.
- [ ] **Não fake funcionalidades de segurança/pagamento.** Se não há infraestrutura real por trás, deixe a tela honesta (mensagem clara de "não implementado"), como foi feito em Billing/Notificações/Segurança.
- [ ] **Manter Atualizado este documento e o `PROGRESS.md`** a cada sessão relevante.
