# SIMPLISOFT — DIRETRIZES DE IMPLEMENTAÇÃO DO PILOTO
## Orquestração de Agentes + RPA + Playwright

**Documento destinado ao Claude Code / agente de desenvolvimento.**

> Este documento deve ser tratado como uma camada estratégica de implementação sobre o projeto existente. Não substituir nem apagar funcionalidades já implementadas. Primeiro analisar o código atual, identificar a arquitetura existente e incorporar os conceitos abaixo de forma incremental.

---

# 1. OBJETIVO DO PILOTO

Transformar o produto atual de criação/orquestração de agentes em uma plataforma capaz de:

- criar agentes especializados;
- definir objetivo e instruções;
- conectar ferramentas;
- executar tarefas automaticamente;
- acessar sistemas web através de Playwright;
- consumir APIs/MCP;
- executar em horários programados;
- registrar cada execução;
- tratar falhas;
- solicitar aprovação humana quando necessário;
- entregar resultados por canais configuráveis;
- manter histórico e auditoria.

A plataforma deve funcionar como um **Agent Operations Center** para clientes empresariais.

---

# 2. PRINCÍPIO ARQUITETURAL MAIS IMPORTANTE

Não acople o produto diretamente ao Cowork.

O sistema deve possuir uma abstração chamada, conceitualmente:

`ExecutionProvider`

Ela permite trocar o mecanismo de execução sem mudar o restante da aplicação.

Exemplo:

```text
Agent
  ↓
Workflow
  ↓
ExecutionProvider
  ├── ClaudeCodeProvider
  ├── CoworkProvider (futuro/opcional)
  ├── ApiAgentProvider
  └── LocalBrowserProvider
```

O piloto pode utilizar Claude Code como ambiente de desenvolvimento e Playwright MCP como ferramenta de browser.

O produto final deve possuir sua própria camada de orquestração.

---

# 3. ARQUITETURA PROPOSTA

```text
┌───────────────────────────────────────────────┐
│                WEB APP / DASHBOARD            │
│                                               │
│ Agentes | Workflows | Integrações | Execuções │
└──────────────────────┬────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────┐
│                API / ORCHESTRATOR             │
│                                               │
│ Auth | Tenancy | Scheduling | Policies        │
└───────────────┬───────────────┬───────────────┘
                │               │
                ▼               ▼
         ┌────────────┐   ┌──────────────┐
         │ Job Queue  │   │ Agent Engine │
         └─────┬──────┘   └──────┬───────┘
               │                 │
               └────────┬────────┘
                        ▼
               ┌────────────────┐
               │ Tool Gateway   │
               └───────┬────────┘
                       │
        ┌──────────────┼────────────────┐
        ▼              ▼                ▼
   Playwright        APIs              MCP
        │              │                │
        ▼              ▼                ▼
    Sistemas       Sistemas         Serviços
      Web          externos         conectados

                        │
                        ▼
               ┌────────────────┐
               │ Result / Audit │
               └───────┬────────┘
                       │
             ┌─────────┼─────────┐
             ▼         ▼         ▼
           Email    Telegram   Dashboard
```

---

# 4. CONCEITO DE AGENTE

Criar/adequar a entidade `Agent`.

Campos conceituais:

```text
id
tenantId
name
description
type
status
systemInstructions
objective
modelProvider
model
executionProvider
knowledgeSources
toolIds
schedule
approvalPolicy
outputChannels
createdAt
updatedAt
```

Não é necessário implementar todos os campos de uma vez.

Priorizar os necessários ao piloto.

---

# 5. CONCEITO DE FERRAMENTA

Criar uma abstração de ferramentas.

Exemplos:

```text
browser.playwright
http.request
email.send
telegram.send
filesystem.read
filesystem.write
mcp.tool
```

Cada ferramenta precisa declarar:

```text
name
description
inputSchema
permissions
enabled
```

O agente só pode utilizar ferramentas explicitamente vinculadas a ele.

---

# 6. PLAYWRIGHT COMO CAMADA RPA

Adicionar Playwright como ferramenta de automação web.

Para o piloto, considerar o Playwright MCP.

O agente deve conseguir realizar operações como:

```text
navigate
snapshot
click
fill
select
wait
extract
download
screenshot
```

Preferir interação baseada em elementos/estrutura da página em vez de coordenadas de tela.

A integração deve ser isolada do restante do sistema.

Criar conceitualmente:

```text
BrowserSession
BrowserTask
BrowserAction
BrowserExecution
```

---

# 7. SESSÕES DO NAVEGADOR

Uma sessão deve pertencer a um tenant/agente/workflow conforme a política definida.

Nunca compartilhar sessão entre clientes.

Suportar:

```text
new session
persistent session
isolated session
```

Quando houver necessidade de login, o fluxo deve prever configuração segura das credenciais.

Não armazenar senha em prompt.

---

# 8. CREDENCIAIS

Criar uma camada de credenciais.

Exemplo:

```text
Credential
├── id
├── tenantId
├── name
├── type
├── encryptedData
├── metadata
└── status
```

Tipos possíveis:

```text
login
api_key
oauth
telegram_bot
smtp
browser_session
```

A interface deve permitir ao cliente configurar a integração sem expor secrets no histórico de execução.

---

# 9. EXECUÇÃO

Criar uma entidade conceitual:

`AgentExecution`

Campos:

```text
id
tenantId
agentId
workflowId
status
startedAt
finishedAt
trigger
input
output
error
cost
tokens
actionsCount
approvalRequired
```

Status:

```text
queued
running
waiting_approval
completed
failed
cancelled
```

---

# 10. LOG DE AÇÕES

Toda execução deve registrar ações relevantes.

Exemplo:

```text
09:00 Agent iniciado
09:00 Navegando para CRM
09:01 Login validado
09:02 Abrindo relatório
09:03 Dados coletados
09:04 Análise iniciada
09:05 Relatório produzido
09:05 Telegram enviado
09:05 Execução concluída
```

Não registrar secrets.

O usuário deve conseguir abrir uma execução e visualizar uma linha do tempo.

---

# 11. AGENDAMENTO

O agente deve poder ter:

```text
manual
once
daily
weekly
monthly
cron
event
webhook
```

Exemplo:

```text
Agente Comercial
Segunda a sexta
18:00
```

Fluxo:

```text
Scheduler
 ↓
Job
 ↓
Queue
 ↓
Agent Engine
 ↓
Execution
```

Não executar trabalhos longos diretamente dentro da requisição HTTP.

---

# 12. RETRY E FALHAS

O agente precisa distinguir:

### Falha recuperável

Exemplos:

- timeout;
- página ainda carregando;
- erro temporário de rede;
- API temporariamente indisponível.

Ação:

```text
retry
```

### Falha que exige intervenção

Exemplos:

- credencial inválida;
- CAPTCHA;
- mudança estrutural do sistema;
- ação proibida;
- aprovação necessária.

Ação:

```text
pause
+
notify
```

---

# 13. APROVAÇÃO HUMANA

Criar um mecanismo genérico:

```text
ApprovalRequest
```

Exemplo:

```text
Agente de Marketing encontrou oportunidade.

Ação proposta:
Publicar Reel "5 erros..."

[ Aprovar ]
[ Rejeitar ]
[ Editar ]
```

O workflow deve continuar após aprovação.

---

# 14. POLÍTICA DE AUTONOMIA

Cada agente deve possuir uma política:

```text
READ_ONLY
RECOMMEND
REQUIRE_APPROVAL
CONTROLLED_AUTONOMY
```

Por padrão, novas ações que alterem dados externos devem começar em modo de aprovação.

---

# 15. WORKFLOW

Criar a possibilidade de futuramente encadear agentes.

Modelo:

```text
Workflow
 ├── Trigger
 ├── Step 1
 ├── Step 2
 ├── Step 3
 ├── Approval
 └── Output
```

Exemplo:

```text
[Coletar dados]
      ↓
[Analisar]
      ↓
[Gerar relatório]
      ↓
[Enviar Telegram]
```

E futuramente:

```text
[Coletar]
 ↓
[Analista]
 ↓
[Redator]
 ↓
[Revisor]
 ↓
[Aprovação]
 ↓
[Publicador]
```

Não é necessário implementar um editor visual completo no primeiro ciclo.

---

# 16. PRIMEIRO CASO DE USO DO PILOTO

Implementar um agente:

## "Analista de Produtividade Comercial"

Objetivo:

Acessar uma plataforma de vendas, coletar indicadores e entregar um resumo diário.

### Entrada

- URL;
- credencial/sessão;
- período;
- regras de indicadores;
- canal de saída.

### Execução

```text
1. Abrir sistema
2. Verificar sessão
3. Acessar módulo de vendas
4. Selecionar período
5. Coletar dados
6. Validar
7. Estruturar dados
8. Enviar dados ao modelo
9. Gerar análise
10. Produzir relatório
11. Enviar Telegram/Email
12. Registrar execução
```

---

# 17. EXEMPLO DE SAÍDA

```text
📊 RESUMO COMERCIAL
18/09/2026

Equipe: 12 vendedores
Vendas: R$ 87.450
Leads: 143
Conversão: 18,4%

DESTAQUES
• Vendedor A: 18 vendas
• Vendedor B: R$ 12.400

ATENÇÃO
• 4 vendedores abaixo da meta diária
• 37 leads sem contato há mais de 24h

ANÁLISE
A conversão ficou abaixo da média dos últimos 7 dias.

RECOMENDAÇÃO
Priorizar os leads recebidos no período de maior conversão.
```

Os valores acima são apenas exemplo de formato. Não criar dados fictícios como se fossem reais.

---

# 18. SEGUNDO CASO DE USO

Depois do comercial:

## "Analista de Marketing"

Fluxo:

```text
Instagram / Meta
 ↓
Métricas
 ↓
Histórico
 ↓
Análise
 ↓
Recomendações
 ↓
Calendário
 ↓
Conteúdo
 ↓
Aprovação
```

O sistema deve reutilizar a mesma infraestrutura de agente, execução, ferramentas, agenda, logs e aprovação.

---

# 19. DASHBOARD EXISTENTE

Preservar a linguagem visual e a arquitetura já existente no piloto.

A tela atual apresenta:

- projetos;
- campanhas;
- artes;
- créditos;
- criações recentes;
- marcas;
- templates;
- agentes de IA;
- integrações;
- configurações.

Evoluir sem destruir o conceito atual.

Adicionar ao dashboard indicadores como:

```text
AGENTES ATIVOS
EXECUÇÕES HOJE
CONCLUÍDAS
COM ERRO
AGUARDANDO APROVAÇÃO
CRÉDITOS / CONSUMO
```

---

# 20. MENU "AGENTES DE IA"

Essa área deve permitir:

### Lista

```text
Nome
Tipo
Status
Última execução
Próxima execução
Taxa de sucesso
```

### Detalhes

Abas sugeridas:

```text
Visão geral
Instruções
Ferramentas
Integrações
Agendamento
Permissões
Execuções
Logs
Custos
```

---

# 21. CRIAÇÃO DE AGENTE

Wizard:

### Etapa 1
Nome e objetivo.

### Etapa 2
Especialidade.

### Etapa 3
Ferramentas.

### Etapa 4
Fontes de dados.

### Etapa 5
Agendamento.

### Etapa 6
Permissões.

### Etapa 7
Canal de saída.

### Etapa 8
Teste.

### Etapa 9
Ativar.

---

# 22. TESTE DO AGENTE

Antes de ativar:

```text
[ Testar agente ]
       ↓
Executar sandbox
       ↓
Mostrar ações
       ↓
Mostrar resultado
       ↓
Mostrar custo
       ↓
[ Ativar ]
```

Não ativar automaticamente um agente recém-criado.

---

# 23. OBSERVABILIDADE

O sistema deve permitir descobrir:

- por que uma execução falhou;
- qual ferramenta falhou;
- quanto tempo levou;
- quais ações foram realizadas;
- qual saída foi produzida;
- quanto custou;
- se houve aprovação;
- quantas tentativas foram feitas.

---

# 24. MULTI-TENANCY

Todo recurso operacional deve possuir:

```text
tenantId
```

Aplicar isolamento em:

- agentes;
- workflows;
- credenciais;
- integrações;
- execuções;
- logs;
- arquivos;
- créditos;
- configurações.

Nunca confiar apenas no frontend para isolamento.

---

# 25. CRÉDITOS / CONSUMO

O dashboard já possui conceito de créditos.

Evoluir para contabilizar:

```text
execuções
tokens
modelo utilizado
tempo de browser
ações
integrações
```

Não precisa calcular preço definitivo nesta fase.

Primeiro criar uma estrutura de consumo auditável.

---

# 26. REGRAS DE SEGURANÇA

Implementar como requisitos:

- credenciais fora de prompts;
- secrets criptografados;
- isolamento por tenant;
- logs sem secrets;
- permissões por ferramenta;
- aprovação para ações sensíveis;
- timeout de execução;
- limite de retries;
- limite de duração;
- bloqueio de ações destrutivas por padrão;
- proteção contra instruções maliciosas encontradas em páginas;
- validação do domínio antes de executar automações;
- permitir lista de domínios autorizados por agente.

---

# 27. RPA: DOMÍNIO AUTORIZADO

Cada agente RPA deve possuir uma allowlist.

Exemplo:

```text
crm.empresa.com.br
erp.empresa.com.br
app.empresa.com.br
```

O agente não deve navegar livremente para qualquer domínio durante uma rotina empresarial.

---

# 28. PROMPT INJECTION E CONTEÚDO NÃO CONFIÁVEL

Tratar tudo que vier de:

- páginas web;
- emails;
- documentos externos;
- mensagens;
- campos de usuários;

como **dados potencialmente não confiáveis**.

Nunca permitir que conteúdo encontrado na página altere silenciosamente:

- objetivo do agente;
- permissões;
- credenciais;
- políticas;
- domínio permitido;
- aprovação exigida.

---

# 29. STACK SUGERIDA PARA O PILOTO

Preservar a stack existente sempre que possível.

Caso seja necessário implementar backend:

```text
Node.js
Fastify
PostgreSQL
Prisma
Redis
BullMQ
Docker
Playwright
Playwright MCP
Claude API / ambiente Claude
```

Frontend:

```text
React
TypeScript
Vite
Tailwind
shadcn/ui
PWA
```

Não adicionar tecnologia apenas por preferência. Reutilizar componentes já existentes.

---

# 30. ESTRATÉGIA DE IMPLEMENTAÇÃO

Não tentar construir a plataforma inteira de uma vez.

### Sprint 1 — Fundamentos

- Agent;
- Tool;
- Execution;
- logs;
- status;
- tenant.

### Sprint 2 — Scheduler

- agendamento;
- fila;
- worker;
- retry.

### Sprint 3 — Playwright

- BrowserSession;
- BrowserTask;
- domínio autorizado;
- execução controlada.

### Sprint 4 — Primeiro agente real

- Analista Comercial;
- coleta;
- análise;
- relatório.

### Sprint 5 — Entrega

- Telegram;
- email;
- histórico.

### Sprint 6 — Aprovação

- ApprovalRequest;
- níveis de autonomia.

### Sprint 7 — Marketing

- novo agente;
- reutilização da infraestrutura.

---

# 31. CRITÉRIOS DE ACEITAÇÃO DO PILOTO

O piloto será considerado funcional quando:

1. um cliente puder criar um agente;
2. o agente puder possuir ferramentas;
3. houver uma agenda;
4. uma execução puder ser iniciada;
5. Playwright puder acessar um sistema autorizado;
6. dados puderem ser coletados;
7. Claude puder interpretar os dados;
8. o resultado puder ser entregue;
9. a execução ficar registrada;
10. uma falha puder ser identificada;
11. uma execução puder exigir aprovação;
12. o agente puder ser ativado/desativado;
13. os dados estiverem isolados por tenant.

---

# 32. DIRETRIZ PARA O CLAUDE CODE

Antes de alterar código:

1. analisar a estrutura atual;
2. identificar stack;
3. identificar banco;
4. identificar entidades existentes;
5. identificar autenticação;
6. identificar tenancy;
7. identificar componentes de UI;
8. identificar funcionalidades já implementadas;
9. produzir um mapa de impacto;
10. só então implementar.

Não reescrever o projeto.

Não substituir funcionalidades existentes sem necessidade.

Não criar mocks quando a funcionalidade real puder ser implementada.

Quando uma integração externa ainda não estiver disponível, criar uma interface/adaptador bem definido e um modo de teste.

---

# 33. RESULTADO ESPERADO

Ao final do piloto, a Simplisoft deverá ter deixado de ser apenas uma interface para criação de conteúdo/agentes e passar a demonstrar o conceito:

> **"Um cliente configura um agente, dá a ele ferramentas e regras, define quando ele deve trabalhar e recebe o resultado sem precisar executar manualmente o processo."**

Esse é o núcleo do produto.

---

# 34. EVOLUÇÃO FUTURA

Depois do piloto:

```text
Agente
 ↓
Agentes especializados
 ↓
Workflows
 ↓
Multi-agent workflows
 ↓
Marketplace de agentes
 ↓
Templates por segmento
 ↓
SaaS de automação inteligente
```

A plataforma deve ser construída de forma que o piloto seja o primeiro caso real dessa visão, e não um protótipo descartável.
