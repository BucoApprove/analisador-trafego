# Plano de Atualização: Métricas e Modelo de Atribuição

## Visão Geral

Atualização do sistema de análise de tráfego para incluir métricas de desempenho de campanhas, análise de vendas e um modelo de atribuição multi-toque que conecta registros de leads a conversões reais.

---

## Fontes de Dados

| Fonte | Tipo | Uso |
|---|---|---|
| Planilha de Leads | BigQuery | Registros de cadastros com UTMs |
| Planilha de Vendas | BigQuery | Registros de compras realizadas |
| Meta Ads | API | Dados de campanhas, criativos e custos |

---

## Métricas e Indicadores

### 1. Campanhas

| Métrica | Descrição |
|---|---|
| Leads gerados | Quantidade de cadastros originados por campanha |
| Vendas atribuídas | Vendas Final, Originada, Assistida e Impactada (ver modelo abaixo) |
| Custo por lead real | Gasto da campanha ÷ leads gerados |
| Custo por venda real | Gasto da campanha ÷ vendas finais |
| Taxa de conversão real | Leads que compraram ÷ total de leads da campanha |

### 2. Vendas

| Métrica | Descrição |
|---|---|
| Produtos que mais venderam | Ranking por volume e receita |
| Canais que mais venderam | Ex: orgânico, pago, direto |
| Campanhas que mais venderam | Por cada tipo de atribuição |
| Criativos que mais venderam | Cruzamento de creative_id com vendas |
| Funis que impactaram a venda | Sequência de campanhas percorridas até a compra |
| Tempo de jornada de compra | Dias entre primeiro registro e data da venda |

### 3. Páginas *(pendente — em standby)*

- Acessos por página
- Taxa de carregamento
- Conversão atrelada (se viável)

---

## Modelo de Atribuição Multi-Toque

### Conceito

Um lead pode ter múltiplos registros no sistema, cada um com UTMs diferentes, antes de realizar uma compra. O modelo classifica a contribuição de cada campanha em quatro tipos.

### Tipos de Atribuição

| Tipo | Definição |
|---|---|
| **Final** | Campanha do **último** registro com UTM antes da compra (last-touch) |
| **Originada** | Campanha do **primeiro** registro com UTM antes da compra (first-touch) |
| **Assistida** | Campanha de registros **intermediários** — nem primeiro nem último toque |
| **Impactada** | Campanha que apareceu em **qualquer** toque da jornada (Final + Originada + Assistida) |

> **Impactada é o superset.** Toda venda Final, Originada ou Assistida também conta como Impactada.

### Exemplo Prático

**Jornada do lead:**
```
[1] Cadastro via PC01_Captura
[2] Cadastro via PC01_Remarketing
[3] Cadastro via PC01_Vendas
[4] → Compra: BucoApprove
```

| Campanha | Final | Originada | Assistida | Impactada |
|---|:---:|:---:|:---:|:---:|
| PC01_Captura | ✗ | ✓ | ✗ | ✓ |
| PC01_Remarketing | ✗ | ✗ | ✓ | ✓ |
| PC01_Vendas | ✓ | ✗ | ✗ | ✓ |

### Regras de Negócio

1. **Lead com único registro antes da compra:** a campanha conta como Final, Originada e Impactada simultaneamente.
2. **Mesma campanha aparece múltiplas vezes na jornada do lead:** conta apenas uma vez em cada tipo de atribuição.
3. **Registros após a data da compra:** ignorados completamente em todos os tipos.
4. **Registros sem UTM de campanha:** não entram no modelo de atribuição.

### Uso Analítico Esperado

- **Finais** → responsabilidade direta pela conversão. Métrica principal de ROI.
- **Originadas** → campanhas que iniciam jornadas. Essencial para avaliar topo de funil.
- **Assistidas** → campanhas de meio de funil. Identificam o papel de aquecimento/remarketing.
- **Impactadas** → visão total de influência. Responde "essa campanha tocou compradores?".

---

---

## Melhoria: Coluna "Leads Válidos" na Aba Captura (Perpétuo)

### Problema Atual

A coluna **RESULTADOS** na aba Captura exibe as conversões reportadas pelo Meta Ads, que frequentemente registra conversões inexistentes ou duplicadas. Isso torna o CPR irreal e a análise de performance imprecisa.

### Solução

Adicionar a coluna **LEADS VÁLIDOS** ao lado de RESULTADOS, exibindo a contagem real de leads captados conforme o banco de dados interno (BigQuery), cruzando:

- `utm_campaign` do registro de lead = nome da campanha no Meta Ads
- `lead_register` (data de criação do registro) dentro do período selecionado na interface

### Mapeamento de Campo

O nome da campanha no Meta Ads corresponde diretamente ao valor de `utm_campaign` nos registros de lead. Exceção: espaços em branco são codificados como HTML encoding — tratar na query ou na normalização.

### Layout Esperado na UI

| Campanha | INVESTIDO | RESULTADOS *(Meta)* | LEADS VÁLIDOS *(BigQuery)* | CPR |
|---|---|---|---|---|
| PC01_Captura_CriatosNovos | R$ 28,93 | 2 | ? | R$ 14,47 |
| PC01_Captura_Criativos0205_Leva1 | R$ 31,74 | 5 | ? | R$ 6,35 |

> **CPR futuro:** calcular também com base em Leads Válidos para ter custo real por lead.

### Regras

1. Filtro de data usa o campo `lead_register` da tabela de leads.
2. Filtro de campanha usa `utm_campaign` = nome da campanha (normalizar espaços).
3. O período consultado é o mesmo selecionado no seletor de datas da aba Perpétuo.

---

## Melhoria: Carregamento de Campanhas Sob Demanda

### Comportamento Atual

Ao acessar a aba Perpétuo, as campanhas são carregadas **automaticamente**, consumindo a API do Meta Ads (ou o cache) sem ação do usuário.

### Comportamento Desejado

As campanhas só devem carregar após o usuário **selecionar o período e clicar em Atualizar**. Isso evita chamadas desnecessárias ao abrir a página e garante que o período correto está sempre selecionado antes do fetch.

### Mudança Necessária

No [TabPerpetuo.tsx](../src/pages/dashboard/TabPerpetuo.tsx): remover o `useEffect` que dispara `loadData()` automaticamente ao montar o componente. O carregamento passa a ser 100% acionado pelo botão "Atualizar".

---

## Estado Atual do Cache (Diagnóstico)

O sistema já possui cache em múltiplas camadas para dados do Meta Ads:

| Camada | Implementação | TTL | Bypass |
|---|---|---|---|
| **Frontend (React)** | `Map` global em memória | Duração da sessão | Botão "Atualizar" |
| **CDN (Vercel)** | Header `Cache-Control` / `s-maxage` | 5 min | Parâmetros de query |
| **Backend (Supabase)** | Tabela `perpetuo_cache` (JSONB) | 60 min | `?nocache=1` |
| **Cron de pré-aquecimento** | `refresh-perpetuo-cache.ts` (hourly) | Implícito | — |

O botão "Atualizar" já força bypass de todas as camadas adicionando `nocache=1`.

**Atenção:** A aba **Relatório API** (`api/report.ts`) **não usa cache** — sempre busca dados frescos do Meta. Isso é intencional para relatórios sob demanda para IA.

---

## Próximos Passos

- [ ] Mapear estrutura das tabelas de leads e vendas no BigQuery
- [ ] Definir campos de UTM disponíveis (utm_source, utm_medium, utm_campaign, utm_content)
- [ ] Criar endpoint para consulta de Leads Válidos por campanha e período (BigQuery)
- [ ] Adicionar coluna LEADS VÁLIDOS na aba Captura do Perpétuo
- [ ] Remover auto-load de campanhas ao abrir a aba Perpétuo
- [ ] Construir queries de atribuição multi-toque no BigQuery
- [ ] Criar endpoints/views para o frontend consumir (modelo de atribuição)
- [ ] Desenvolver visualizações no dashboard (vendas por tipo de atribuição)
- [ ] Páginas e conversão *(em standby)*
