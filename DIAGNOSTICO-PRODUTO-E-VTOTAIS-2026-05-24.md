# Diagnóstico. Campo produto ausente + vendas_totais_periodo vazio

## Onde está o cadastro produto → campanha

**Origem:** Tabela Supabase `campaign_produto_map`, carregada em `api/report.ts` pela função `loadProdutoMap()` (linha ~39).

Schema da tabela (inferido do código + tela de config recém criada):

| Coluna | Tipo | Exemplo |
|---|---|---|
| `id` | bigint | 1 |
| `account` | text | `'conta1'` |
| `prefixo` | text | `'imers'` (lowercase, match por `includes`) |
| `produto_ids` | integer[] | `[12345, 67890]` |
| `label` | text | `'Imersão Enare'` |
| `created_at` | timestamptz | `2026-05-24T...` |

**Status atual:** A tabela foi criada (SQL fornecido) mas **ainda não foi provisionada no Supabase** — nenhuma linha foi inserida. Isso é a raiz de tudo.

---

## Hipótese A. Falta expor `produto` no SELECT

**Veredicto: CONFIRMADA (parcialmente)**

O campo `produto` (nome legível do produto) **não existe na interface `ReportRow`** nem é emitido em nenhum `rows.push`. A interface `ProdutoMap` existe internamente mas seus dados (`label`) nunca chegam à resposta da API.

O que existe na `ReportRow`:
- `vendas_totais_periodo` — quantidade de vendas (string)

O que **não existe**:
- `produto` — nome do produto (ex: "Imersão Enare")
- `produto_label` — nem variante alguma

**Mudança necessária:** Adicionar campo `produto` (e opcionalmente `produto_ids`) à `ReportRow` e preenchê-lo no `rows.push` de campanha consultando o `produtoMap` pelo mesmo `includes` do `prefixo`.

---

## Hipótese B. `vendas_totais_periodo` depende do Problema 1

**Veredicto: CONFIRMADA (é a causa raiz do campo vazio)**

O fluxo completo de `vendas_totais_periodo` em `api/report.ts`:

1. `loadProdutoMap(account)` → consulta Supabase → retorna `[]` (tabela vazia)
2. `produtoMap.length > 0` é `false` → a query BQ de vendas por produto é **curto-circuitada**:
   ```typescript
   produtoMap.length > 0
     ? bqQuery(`SELECT ID_do_Produto...`)
     : Promise.resolve({ rows: [], totalRows: 0 })  // ← cai aqui
   ```
3. `vendasPorProduto` fica `{}`
4. Loop `for (const entry of produtoMap)` não itera (array vazio)
5. `vendasTotais` fica `{}`
6. No `rows.push`, o IIFE busca `produtoMap.find(e => lower.includes(e.prefixo))` → retorna `undefined` → campo fica `''`

**Resultado: 0 de 17 campanhas preenchidas — exatamente o observado.**

Dependência confirmada: sem linhas no `campaign_produto_map` do Supabase, o campo será sempre `""` independentemente de haver vendas no BigQuery.

---

## Hipótese C. Mismatch de nome de produto

**Veredicto: INCONCLUSIVA (não pode ser testada até a tabela ter dados)**

O match é por `ID_do_Produto` (integer), não por nome — então mismatch de texto não se aplica aqui. O risco seria `produto_ids` cadastrado com ID errado. Não há como confirmar sem dados na tabela.

O que pode acontecer após cadastrar:
- Se o `ID_do_Produto` no BQ for `int64` e chegar como string no JSON, o `parseInt` já trata isso.
- Se o Status da venda não for exatamente `'Aprovado'` (maiúsculo), a query filtra errado → **risco real** a validar.

---

## CAUSA RAIZ

**Dois problemas independentes, um alimenta o outro:**

1. **`campaign_produto_map` está vazia no Supabase.** Nenhum produto foi cadastrado ainda. A API curto-circuita corretamente (`produtoMap.length > 0` guard), então nenhuma query BQ é feita e `vendasTotais` fica `{}`.

2. **Campo `produto` nunca foi adicionado ao schema da API.** A interface `ProdutoMap` existe internamente, o `label` (nome legível) existe no cadastro, mas ele nunca é exposto na `ReportRow` nem emitido no `rows.push`.

---

## PLANO DE FIX

### Fix 1 — Cadastrar produtos no Supabase (pré-requisito, fora do código)

Criar a tabela (SQL já fornecido) e inserir ao menos uma linha de teste:
```sql
INSERT INTO campaign_produto_map (account, prefixo, produto_ids, label)
VALUES ('conta1', 'imersaoenare', ARRAY[ID_REAL], 'Imersão Enare');
```
O `ID_REAL` deve ser obtido com a query BQ descrita na tela de config.

### Fix 2 — Adicionar campo `produto` ao schema da API

**Arquivo:** `api/report.ts`

**a) Interface `ReportRow`** — adicionar após `vendas_totais_periodo`:
```typescript
produto:               string  // label do produto vendido (ex: "Imersão Enare")
```

**b) `rows.push` — nível campanha** — adicionar junto ao bloco `vendas_totais_periodo`:
```typescript
produto: (() => {
  const lower = camp.name.toLowerCase().trim()
  return produtoMap.find(e => lower.includes(e.prefixo))?.label ?? ''
})(),
```

**c) `rows.push` — níveis adset e ad** — adicionar `produto: ''` (vazio, não se aplica nesses níveis).

**d) CSV headers** — adicionar `'produto'` ao array de headers (junto com `vendas_totais_periodo`).

### Fix 3 — Validar o filtro `Status = 'Aprovado'` no BigQuery

Após cadastrar um produto e fazer o deploy, verificar se a query retorna algo:
```sql
SELECT DISTINCT Status
FROM `projeto.dataset.Hotmart_Greenn_Unificada`
LIMIT 20
```
Se o valor real for `'aprovado'` (minúsculo) ou `'Aprovado '` (com espaço), ajustar a query em `fetchUtmCounts`.

---

## SCHEMA RESULTANTE (após o fix)

Cada linha do retorno passará a ter:
- `produto`: nome legível do produto vendido pela campanha (ex: `"Imersão Enare"`), ou `""` se não mapeado
- `vendas_totais_periodo`: quantidade total de vendas aprovadas do produto no período (ex: `"42"`), ou `""` se não mapeado ou zero

Nenhum campo existente é alterado ou removido.

---

## ESTIMATIVA

- Fix 2 (código): ~15 min — 3 edições pontuais em `report.ts`, TypeScript check, commit/push
- Fix 1 (Supabase): ~10 min — criar tabela + inserir linhas via tela de config ou SQL direto
- Fix 3 (validar Status): ~5 min — uma query BQ
- Deploy Vercel: ~60s automático após push
- **Total: ~30 min**

---

## RISCOS

1. **`Status` com valor diferente de `'Aprovado'`:** A query silencia vendas reais → `vendas_totais_periodo` voltaria `""` mesmo com dados. Validar com `SELECT DISTINCT Status` antes.
2. **`ID_do_Produto` cadastrado errado:** Se o ID inserido no Supabase não bater com o da tabela BQ, `vendasPorProduto[id]` sempre retorna `undefined` e o total fica `0` → campo vira `""`. Validar com a query de descoberta de IDs.
3. **Prefixo muito curto/genérico:** Um prefixo como `'venda'` vai bater em campanhas não relacionadas. Preferir prefixos com ≥8 chars e únicos, ex: `'imersaoenare'` em vez de `'imers'`.
