# SIMPLISOFT — MAPA MENTAL DO PRODUTO DE ORQUESTRAÇÃO DE AGENTES E RPA

**Versão:** Piloto estratégico — setembro de 2026  
**Objetivo do documento:** servir como fonte principal no NotebookLM para compreender, organizar e expandir o produto.

---

## 1. VISÃO CENTRAL

### Produto
**Simplisoft AI Orchestration**

Plataforma SaaS para empresas criarem, configurarem, executarem, monitorarem e receberem resultados de agentes de IA especializados em processos empresariais.

### Ideia central
O cliente não compra "prompts" nem apenas acesso a um modelo de IA.

O cliente contrata **agentes digitais especializados**, configurados pela Simplisoft para executar rotinas reais da empresa.

Exemplos:

- Agente Comercial
- Agente de Marketing
- Agente Financeiro
- Agente Administrativo
- Agente de Atendimento
- Agente de Monitoramento
- Agente de Relatórios
- Agentes personalizados

---

# 2. MAPA MENTAL PRINCIPAL

```text
SIMPLISOFT AI ORCHESTRATION
│
├── CLIENTES
│   ├── Empresas
│   ├── Agências
│   ├── Departamentos
│   └── Usuários / equipes
│
├── AGENTES DE IA
│   ├── Comercial
│   ├── Marketing
│   ├── Financeiro
│   ├── Administrativo
│   ├── Atendimento
│   └── Personalizados
│
├── AUTOMAÇÃO / RPA
│   ├── Navegação web
│   ├── Login / sessão
│   ├── Cliques
│   ├── Formulários
│   ├── Leitura de dados
│   ├── Downloads / uploads
│   ├── APIs
│   ├── Planilhas
│   └── Sistemas legados
│
├── INTELIGÊNCIA
│   ├── Coleta
│   ├── Validação
│   ├── Análise
│   ├── Comparação
│   ├── Interpretação
│   ├── Recomendação
│   └── Geração de conteúdo
│
├── ORQUESTRAÇÃO
│   ├── Agendamento
│   ├── Gatilhos
│   ├── Filas
│   ├── Dependências
│   ├── Retry
│   ├── Timeout
│   ├── Aprovação humana
│   └── Encadeamento de agentes
│
├── CONECTORES
│   ├── APIs
│   ├── MCP
│   ├── Playwright
│   ├── Email
│   ├── Telegram
│   ├── WhatsApp
│   ├── Google
│   ├── Meta
│   ├── CRMs
│   ├── ERPs
│   └── Sistemas próprios
│
├── ENTREGA
│   ├── Dashboard
│   ├── Email
│   ├── Telegram
│   ├── WhatsApp
│   ├── Arquivo
│   └── Webhook
│
├── GOVERNANÇA
│   ├── Permissões
│   ├── Credenciais
│   ├── Logs
│   ├── Auditoria
│   ├── Aprovação
│   ├── Limites de ação
│   └── Segurança
│
└── MODELO DE NEGÓCIO
    ├── Implantação
    ├── Mensalidade
    ├── Agentes contratados
    ├── Consumo de IA
    ├── Integrações
    └── Serviços adicionais
```

---

# 3. O QUE TORNA O PRODUTO DIFERENTE

O produto deve ser entendido como uma combinação de:

**IA + RPA + Integrações + Orquestração + Supervisão humana.**

Não é apenas um chatbot.

Um agente pode:

1. acessar um sistema;
2. coletar dados;
3. interpretar dados;
4. tomar uma decisão dentro de regras definidas;
5. produzir uma saída;
6. solicitar aprovação;
7. executar uma ação;
8. registrar tudo;
9. comunicar o resultado.

---

# 4. EXEMPLO DE AGENTE COMERCIAL

## Objetivo

Acompanhar diariamente a produtividade da equipe de vendas.

## Fluxo

```text
Agendamento
   ↓
Abrir plataforma de vendas
   ↓
Autenticar sessão
   ↓
Consultar período
   ↓
Coletar vendedores
   ↓
Coletar vendas / leads / conversões
   ↓
Validar dados
   ↓
Calcular indicadores
   ↓
Claude interpreta
   ↓
Gerar resumo executivo
   ↓
Enviar Telegram / Email
   ↓
Registrar execução
```

## Possíveis indicadores

- vendas;
- faturamento;
- leads;
- conversão;
- ticket médio;
- atividades;
- produtividade por vendedor;
- atingimento de meta;
- comparação com período anterior;
- anomalias;
- oportunidades.

---

# 5. EXEMPLO DE AGENTE DE MARKETING

## Objetivo

Monitorar marketing e auxiliar na produção de conteúdo.

## Fluxo

```text
Agendamento
   ↓
Consultar Instagram / Meta / campanhas
   ↓
Coletar métricas
   ↓
Comparar histórico
   ↓
Identificar conteúdos de melhor desempenho
   ↓
Identificar padrões
   ↓
Gerar diagnóstico
   ↓
Sugerir calendário editorial
   ↓
Criar briefing / copy / ideias
   ↓
Gerar peças quando houver ferramenta adequada
   ↓
Enviar para aprovação
   ↓
Publicar somente conforme política definida
```

---

# 6. AGENTE NÃO É O MESMO QUE AUTOMAÇÃO

## Automação tradicional

```text
SE acontecer X
ENTÃO faça Y
```

## Agente

```text
Objetivo
+
Contexto
+
Ferramentas
+
Regras
+
Capacidade de raciocínio
+
Execução
+
Verificação
```

## Produto híbrido

A Simplisoft deve combinar os dois.

### Automação determina:
- quando executar;
- quais limites existem;
- quais ferramentas estão disponíveis;
- quando exigir aprovação;
- quando interromper.

### IA determina:
- como interpretar dados;
- como resolver pequenas variações;
- como resumir;
- como classificar;
- como recomendar;
- como adaptar a execução dentro dos limites.

---

# 7. RPA COM PLAYWRIGHT

Playwright pode funcionar como camada de execução de navegador.

A arquitetura conceitual é:

```text
AGENTE
  ↓
ORQUESTRADOR
  ↓
PLAYWRIGHT
  ↓
NAVEGADOR
  ↓
SISTEMA DO CLIENTE
```

Playwright MCP permite que um agente interaja com páginas por meio de snapshots estruturados de acessibilidade, incluindo navegação, cliques, preenchimento de formulários e manutenção de sessões. Ele pode ser utilizado com Claude Code e outros clientes MCP.

### Estratégia

Usar Playwright principalmente quando:

- não existe API;
- o sistema é legado;
- o cliente precisa automatizar uma interface web;
- a operação exige navegador;
- uma API oficial não cobre a tarefa.

Sempre preferir:

**API > integração estruturada/MCP > RPA web.**

RPA deve ser a camada de compatibilidade, não necessariamente a primeira escolha.

---

# 8. COWORK COMO OPCIONAL, NÃO COMO FUNDAMENTO

O produto não deve depender estruturalmente do Cowork.

Cowork pode ser tratado como **um possível ambiente de execução**.

### Estratégia de abstração

```text
                    AGENTE
                      │
                EXECUTION LAYER
                      │
        ┌─────────────┼─────────────┐
        │             │             │
     Cowork       Claude Code    Runtime próprio
        │             │             │
        └─────────────┼─────────────┘
                      │
                  FERRAMENTAS
                      │
          ┌───────────┼───────────┐
          │           │           │
       Playwright    APIs        MCP
```

Isso permite que a Simplisoft tenha seu próprio produto mesmo utilizando componentes do ecossistema Claude.

---

# 9. CENTRAL DE AGENTES

A interface atual do piloto já representa a ideia correta de uma central de operações.

### Dashboard

Indicadores:

- agentes ativos;
- execuções hoje;
- execuções concluídas;
- execuções com erro;
- ações pendentes de aprovação;
- consumo de IA;
- créditos;
- automações ativas.

### Menu

- Dashboard
- Criar
- Projetos
- Campanhas
- Biblioteca
- Marcas
- Templates
- Agentes de IA
- Integrações
- Configurações

### Evolução do conceito

O menu "Agentes de IA" deve se tornar um dos núcleos do produto.

---

# 10. MODELO DE UM AGENTE

Cada agente deve possuir:

```text
AGENTE
│
├── Identidade
│   ├── Nome
│   ├── Descrição
│   ├── Especialidade
│   └── Status
│
├── Objetivo
│
├── Instruções
│
├── Conhecimento
│   ├── Documentos
│   ├── Regras
│   └── Contexto da empresa
│
├── Ferramentas
│   ├── Browser
│   ├── APIs
│   ├── MCP
│   ├── Email
│   └── Mensageria
│
├── Gatilhos
│   ├── Manual
│   ├── Horário
│   ├── Evento
│   └── Webhook
│
├── Permissões
│
├── Aprovação humana
│
├── Saídas
│
├── Histórico
│
└── Métricas
```

---

# 11. ORQUESTRAÇÃO

O orquestrador controla:

### Quando

- diariamente;
- semanalmente;
- mensalmente;
- em horário específico;
- após outro agente;
- quando chegar um evento.

### O quê

- qual agente;
- qual contexto;
- quais ferramentas;
- quais dados;
- quais limites.

### Depois

- guardar resultado;
- enviar relatório;
- chamar outro agente;
- solicitar aprovação;
- repetir;
- encerrar;
- registrar erro.

---

# 12. AGENTES ENCADEADOS

O produto pode evoluir para workflows.

Exemplo:

```text
AGENTE DE DADOS
      ↓
AGENTE ANALISTA
      ↓
AGENTE DE CONTEÚDO
      ↓
AGENTE REVISOR
      ↓
APROVAÇÃO HUMANA
      ↓
AGENTE PUBLICADOR
```

Isso cria uma verdadeira **linha de produção digital**.

---

# 13. APROVAÇÃO HUMANA

Nem toda ação deve ser automática.

### Níveis

**Nível 0 — leitura**

O agente apenas consulta e analisa.

**Nível 1 — recomendação**

O agente recomenda uma ação.

**Nível 2 — aprovação**

O agente prepara a ação e aguarda aprovação.

**Nível 3 — execução controlada**

O agente executa ações previamente autorizadas.

**Nível 4 — autonomia limitada**

O agente pode executar dentro de políticas rígidas.

---

# 14. SEGURANÇA

O produto deve considerar:

- credenciais isoladas por cliente;
- permissões por agente;
- armazenamento seguro de secrets;
- logs de execução;
- trilha de auditoria;
- limite de ações;
- timeout;
- retry controlado;
- bloqueio de ações destrutivas;
- aprovação humana;
- isolamento de sessões;
- proteção contra prompt injection;
- separação entre instrução do cliente e conteúdo não confiável encontrado na web.

---

# 15. MULTITENANCY

A plataforma deve nascer com a lógica:

```text
Simplisoft
│
├── Cliente A
│   ├── Agentes
│   ├── Integrações
│   ├── Credenciais
│   └── Execuções
│
├── Cliente B
│   ├── Agentes
│   ├── Integrações
│   ├── Credenciais
│   └── Execuções
│
└── Cliente C
    ├── Agentes
    ├── Integrações
    ├── Credenciais
    └── Execuções
```

Nada de dados ou credenciais cruzando tenants.

---

# 16. MODELO COMERCIAL

A plataforma pode ser comercializada em camadas.

## Implantação

Inclui:

- levantamento do processo;
- desenho do workflow;
- configuração do agente;
- integração;
- testes;
- treinamento;
- entrada em produção.

## Recorrência

Inclui:

- infraestrutura;
- monitoramento;
- execução;
- manutenção;
- ajustes;
- consumo de IA conforme plano;
- suporte.

## Adicionais

- novos agentes;
- novas integrações;
- novos workflows;
- RPA;
- relatórios personalizados;
- canais adicionais.

---

# 17. VISÃO DE FUTURO

A evolução desejada:

```text
FASE 1
Agente isolado
     ↓
FASE 2
Agente + automação
     ↓
FASE 3
Múltiplos agentes
     ↓
FASE 4
Workflows
     ↓
FASE 5
Agentes especializados por empresa
     ↓
FASE 6
Ecossistema de agentes empresariais
```

---

# 18. TESE DO PRODUTO

**A Simplisoft transforma processos repetitivos de empresas em operações digitais executadas por agentes de IA supervisionados.**

O diferencial não é o modelo de IA isoladamente.

O diferencial é a combinação de:

**processo empresarial + integração + RPA + IA + orquestração + supervisão + entrega.**

---

# 19. PERGUNTAS PARA O NOTEBOOKLM EXPLORAR

1. Qual é a proposta de valor central deste produto?
2. Quais processos empresariais são mais adequados para agentes?
3. Quando utilizar API, MCP ou RPA?
4. Como o Cowork pode complementar o produto sem virar dependência?
5. Como estruturar a camada de execução?
6. Como implementar aprovação humana?
7. Quais riscos existem em agentes que navegam sistemas empresariais?
8. Como estruturar um SaaS multi-tenant?
9. Como cobrar implantação e recorrência?
10. Como transformar agentes isolados em workflows?
11. Quais componentes devem ser construídos pela Simplisoft?
12. Quais componentes podem ser terceirizados para APIs/serviços externos?
13. Qual seria o MVP comercial?
14. Quais funcionalidades são essenciais antes de colocar o produto em produção?
15. Como medir ROI de um agente para o cliente?
