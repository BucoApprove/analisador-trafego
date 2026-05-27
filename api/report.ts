/**
 * GET /api/report
 *
 * Gera um relatório plano (CSV ou JSON) de campanhas Meta Ads para análise por IA.
 *
 * Query params:
 *   token          — DASHBOARD_TOKEN (obrigatório, passado direto na URL)
 *   account        — conta1 | conta2
 *   views          — etapas separadas por vírgula, ex: etapa2,etapa4,etapa5
 *                    ou "all" para todas as views da conta selecionada
 *   since          — YYYY-MM-DD (padrão: 1º do mês atual)
 *   until          — YYYY-MM-DD (padrão: hoje)
 *   format         — csv | json  (padrão: csv)
 *   level          — campaign | adset | ad  (padrão: adset)
 *   time_increment — 1 (diário) | 7 (semanal) — opcional; sem esse param retorna agregado
 *   fields         — minimal | standard (padrão) | full
 *   refresh        — true para forçar re-fetch Meta ignorando cache
 *
 * Exemplo de URL para IA:
 *   https://analisador-trafego.vercel.app/api/report?token=SEU_TOKEN&account=conta1&views=etapa2,etapa4&since=2026-04-01&until=2026-04-20&format=json&level=adset
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { bqQuery, tableLeads, tableVendas } from './_bq.js'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_KEY ?? '',
    { auth: { persistSession: false } },
  )
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

function makeCacheKey(parts: Record<string, string>): string {
  const canonical = Object.keys(parts).sort().map(k => `${k}=${parts[k]}`).join('|')
  return createHash('sha1').update(canonical).digest('hex')
}

async function cacheGet(key: string): Promise<{ data: any; stale: boolean } | null> {
  try {
    const sb = getSupabase()
    const { data } = await sb
      .from('api_cache')
      .select('response, expires_at')
      .eq('cache_key', key)
      .single()
    if (!data) return null
    const stale = data.expires_at !== null && new Date(data.expires_at) <= new Date()
    // fire-and-forget hit count update
    sb.from('api_cache')
      .update({ hit_count: sb.rpc as any, last_hit_at: new Date().toISOString() })
      .eq('cache_key', key)
      .then(() => {})
    return { data: data.response, stale }
  } catch { return null }
}

async function cacheSet(key: string, params: Record<string, string>, response: any, closedPeriod: boolean): Promise<void> {
  try {
    const sb = getSupabase()
    const now = new Date()
    const expires_at = closedPeriod ? null : new Date(now.getTime() + 600_000).toISOString()
    await sb.from('api_cache').upsert({
      cache_key:   key,
      params:      params,
      response:    response,
      fetched_at:  now.toISOString(),
      expires_at:  expires_at,
      hit_count:   0,
      last_hit_at: null,
    }, { onConflict: 'cache_key' })
  } catch { /* cache write failure never breaks the response */ }
}

interface ProdutoMap {
  prefixo:     string       // prefixo do nome da campanha (lowercase)
  produto_ids: number[]     // IDs do produto na Hotmart/Greenn
  label:       string       // nome legível
}

async function loadProdutoMap(account: string): Promise<ProdutoMap[]> {
  try {
    const sb = getSupabase()
    const { data } = await sb
      .from('campaign_produto_map')
      .select('prefixo, produto_ids, label')
      .eq('account', account)
    if (!data) return []
    return data.map(r => ({
      prefixo:     (r.prefixo as string).toLowerCase().trim(),
      produto_ids: (r.produto_ids as number[]) ?? [],
      label:       (r.label as string) ?? '',
    }))
  } catch {
    return []
  }
}


async function loadCustomFilters(account: string, views: string[]): Promise<Record<string, NameFilter>> {
  try {
    const sb = getSupabase()
    const { data } = await sb
      .from('etapa_filters')
      .select('view, include, exclude')
      .eq('account', account)
      .in('view', views)
    if (!data) return {}
    const result: Record<string, NameFilter> = {}
    for (const row of data) {
      result[row.view] = { include: row.include ?? [], exclude: row.exclude ?? [] }
    }
    return result
  } catch {
    return {}
  }
}

const META_BASE = 'https://graph.facebook.com/v19.0'

const ACCOUNT_IDS: Record<string, string> = {
  conta1: 'act_1082683452063319',
  conta2: 'act_565958430809772',
}

interface NameFilter { include: string[]; exclude?: string[] }

const NAME_FILTERS: Record<string, NameFilter> = {
  etapa1:             { include: ['impulsi', 'boost', 'seguidor', '[instagram] - post'] },
  etapa2:             { include: ['captura', 'aula', 'leads_quizenare_'] },
  etapa3:             { include: ['relacionamento', 'engajamento'], exclude: ['ba25', 'ba 25'] },
  etapa4:             { include: ['convers', 'venda', 'pptba_residencias'], exclude: ['ba25', 'ba 25'] },
  etapa5:             { include: ['remarketing', 'retarget', 'rmkt'] },
  anatomia:           { include: ['anatomia'] },
  patologia:          { include: ['patologia'] },
  'lowticket-brasil': { include: ['low ticket brasil', 'lt brasil'] },
  'lowticket-latam':  { include: ['low ticket latam', 'lt latam'] },
}

const VIEW_LABELS: Record<string, string> = {
  etapa1:             'Posts Impulsionados',
  etapa2:             'Captura',
  etapa3:             'Relacionamento',
  etapa4:             'Conversão',
  etapa5:             'Remarketing',
  anatomia:           'Pós-Grad. Anatomia',
  patologia:          'Pós-Grad. Patologia',
  'lowticket-brasil': 'Low Ticket Brasil',
  'lowticket-latam':  'Low Ticket Latam',
}

const CONTA1_VIEWS = ['etapa1', 'etapa2', 'etapa3', 'etapa4', 'etapa5']
const CONTA2_VIEWS = ['anatomia', 'patologia', 'lowticket-brasil', 'lowticket-latam']

function normKw(s: string): string { return s.toLowerCase().replace(/[-_]/g, ' ') }

function matchesFilter(name: string, filter: NameFilter): boolean {
  const lower = normKw(name)
  if (filter.exclude?.some(kw => lower.includes(normKw(kw)))) return false
  return filter.include.some(kw => lower.includes(normKw(kw)))
}

function actionVal(
  actions: { action_type: string; value: string }[] | undefined,
  ...types: string[]
): number {
  if (!actions) return 0
  return types.reduce(
    (sum, t) => sum + Number(actions.find(a => a.action_type === t)?.value ?? 0),
    0,
  )
}

class MetaRateLimitError extends Error {
  constructor(public retryAfter: number = 600) {
    super(`Meta rate limit (code 17). Retry after ${retryAfter}s.`)
    this.name = 'MetaRateLimitError'
  }
}

async function metaGetAll(url: URL): Promise<any[]> {
  const allData: any[] = []
  let nextUrl: string | null = url.toString()
  while (nextUrl) {
    const res = await fetch(nextUrl)
    if (!res.ok) {
      const txt = await res.text()
      // Detecta rate limit code 17 / subcode 2446079
      try {
        const errJson = JSON.parse(txt)
        if (errJson?.error?.code === 17) throw new MetaRateLimitError(600)
      } catch (e) { if (e instanceof MetaRateLimitError) throw e }
      throw new Error(`Meta API ${res.status}: ${txt.substring(0, 300)}`)
    }
    const json = await res.json() as Record<string, unknown>
    allData.push(...((json.data as any[]) ?? []))
    const paging = json.paging as any
    nextUrl = paging?.next ?? null
  }
  return allData
}

function getResultTypes(adset: {
  optimization_goal?: string
  promoted_object?: { custom_conversion_id?: string; custom_event_type?: string }
}, campaignObjective?: string): string[] {
  const po = adset.promoted_object
  if (po?.custom_conversion_id) return [`offsite_conversion.custom.${po.custom_conversion_id}`]
  const event = po?.custom_event_type ?? ''
  if (event === 'OTHER')    return ['offsite_conversion.fb_pixel_custom']
  if (event === 'LEAD')     return ['lead', 'onsite_conversion.lead_grouped']
  if (event === 'PURCHASE') return ['purchase', 'offsite_conversion.fb_pixel_purchase']
  const goal = adset.optimization_goal ?? ''
  if (['LEAD_GENERATION', 'LEAD'].includes(goal)) return ['lead', 'onsite_conversion.lead_grouped']
  const obj = campaignObjective ?? ''
  if (['LEAD_GENERATION', 'OUTCOME_LEADS'].includes(obj)) return ['lead', 'onsite_conversion.lead_grouped']
  if (['OUTCOME_SALES', 'CONVERSIONS'].includes(obj)) return ['purchase', 'offsite_conversion.fb_pixel_purchase']
  return ['lead', 'onsite_conversion.lead_grouped']
}

function csvEscape(val: string | number): string {
  const s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

// ─── Busca leads e vendas reais via UTM (BigQuery) ───────────────────────────

// Etapas que têm dados de leads/vendas reais via UTM
const VIEWS_WITH_UTM = new Set(['etapa2', 'etapa4'])

interface UtmCounts {
  leads:               Record<string, number>  // utm_campaign → leads únicos
  content:             Record<string, number>  // utm_campaign|||utm_medium|||utm_content → leads
  vendas:              Record<string, number>  // utm_campaign → compradores únicos via UTM (any touch) — todos os produtos
  vendasContent:       Record<string, number>  // utm_campaign|||utm_medium|||utm_content → compradores únicos (any touch)
  vendasPorAdId:       Record<string, number>  // ad_id numérico → compradores únicos (any touch)
  vendasLastCamp:      Record<string, number>  // utm_campaign → compradores únicos (last touch)
  vendasLastContent:   Record<string, number>  // utm_campaign|||utm_medium|||utm_content → compradores únicos (last touch)
  vendasLastByAdId:    Record<string, number>  // ad_id numérico → compradores únicos (last touch)
  receita:             Record<string, number>  // utm_campaign → soma Valor_Pago_pelo_Comprador
  lagDias:             Record<string, number>  // utm_campaign → média de dias lead→compra
  vendasTotais:        Record<string, number>  // prefixo → vendas do produto no período (sem join de lead)
  // por produto: chave = prefixo do produto, valor = mapa utm_campaign → count
  vendasByProduto:     Record<string, Record<string, number>>
  vendasLastByProduto: Record<string, Record<string, number>>
  receitaByProduto:    Record<string, Record<string, number>>
  lagDiasByProduto:    Record<string, Record<string, number>>
}

const ATTRIBUTION_WINDOW_DAYS = 30

async function fetchUtmCounts(since: string, until: string, produtoMap: ProdutoMap[] = []): Promise<UtmCounts> {
  const tLeads  = tableLeads()
  const tVendas = tableVendas()

  // Janela de atribuição: vendas até 30 dias após o fim do período do relatório
  const salesUntilDate = new Date(until)
  salesUntilDate.setDate(salesUntilDate.getDate() + ATTRIBUTION_WINDOW_DAYS)
  const salesUntil = salesUntilDate.toISOString().split('T')[0]

  const dateParams = [
    { name: 'since',       value: since,      type: 'DATE' as const },
    { name: 'until',       value: until,      type: 'DATE' as const },
    { name: 'sales_until', value: salesUntil, type: 'DATE' as const },
  ]
  const baseWhere = `DATE(lead_register) >= @since AND DATE(lead_register) <= @until`

  // Filtro por produto: quando há mapeamento, restringe o JOIN às vendas dos produtos
  // cadastrados para esta conta — evita cruzar leads com vendas de outros produtos.
  const allProdutoIds = [...new Set(produtoMap.flatMap(e => e.produto_ids))]
  const produtoFilter = allProdutoIds.length > 0
    ? `AND CAST(s.ID_do_Produto AS INT64) IN (${allProdutoIds.join(', ')})`
    : ''
  const statusFilter = `AND s.Status IN ('APROVADO', 'COMPLETO')`

  const decodeUtm = (col: string) =>
    `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(` +
    `${col}, '%5B', '['), '%5b', '['), '%5D', ']'), '%5d', ']'), '%20', ' '), '+', ' '), '%28', '('), '%29', ')'), '%2C', ',')`

  const [campaignRows, contentRows, salesRows, salesContentRows, vendasAdIdRows, lastCampRows, lastContentRows, lastAdIdRows, receitaRows, vendasProdutoRows] = await Promise.all([
    bqQuery(
      `SELECT ${decodeUtm('utm_campaign')} AS key, COUNT(*) AS cnt
       FROM ${tLeads}
       WHERE utm_campaign IS NOT NULL AND utm_campaign != '' AND ${baseWhere}
       GROUP BY 1`,
      dateParams,
    ),
    bqQuery(
      `SELECT
         ${decodeUtm('utm_campaign')} AS campaign,
         ${decodeUtm('utm_content')}  AS content,
         COUNT(*) AS cnt
       FROM ${tLeads}
       WHERE utm_campaign IS NOT NULL AND utm_campaign != ''
         AND utm_content  IS NOT NULL AND utm_content  != ''
         AND ${baseWhere}
       GROUP BY 1, 2`,
      dateParams,
    ),
    // vendas por campanha — leads no período, vendas na janela de atribuição
    bqQuery(
      `SELECT ${decodeUtm('l.utm_campaign')} AS key,
              COUNT(DISTINCT LOWER(TRIM(l.lead_email))) AS cnt
       FROM ${tLeads} l
       INNER JOIN ${tVendas} s
         ON LOWER(TRIM(l.lead_email)) = LOWER(TRIM(s.E_mail_do_Comprador))
       WHERE l.utm_campaign IS NOT NULL AND l.utm_campaign != ''
         AND DATE(l.lead_register) BETWEEN @since AND @until
         AND DATE(s.Data_de_Aprova____o) BETWEEN @since AND @sales_until
         ${produtoFilter}
         ${statusFilter}
       GROUP BY 1`,
      dateParams,
    ),
    // vendas por criativo (campaign|||content) — leads no período, vendas na janela
    bqQuery(
      `SELECT
         ${decodeUtm('l.utm_campaign')} AS campaign,
         ${decodeUtm('l.utm_content')}  AS content,
         COUNT(DISTINCT LOWER(TRIM(l.lead_email))) AS cnt
       FROM ${tLeads} l
       INNER JOIN ${tVendas} s
         ON LOWER(TRIM(l.lead_email)) = LOWER(TRIM(s.E_mail_do_Comprador))
       WHERE l.utm_campaign IS NOT NULL AND l.utm_campaign != ''
         AND l.utm_content  IS NOT NULL AND l.utm_content  != ''
         AND DATE(l.lead_register) BETWEEN @since AND @until
         AND DATE(s.Data_de_Aprova____o) BETWEEN @since AND @sales_until
         ${produtoFilter}
         ${statusFilter}
       GROUP BY 1, 2`,
      dateParams,
    ),
    // vendas por ad_id numérico — leads no período, vendas na janela
    bqQuery(
      `SELECT
         TRIM(l.utm_content) AS ad_id,
         COUNT(DISTINCT LOWER(TRIM(l.lead_email))) AS cnt
       FROM ${tLeads} l
       INNER JOIN ${tVendas} s
         ON LOWER(TRIM(l.lead_email)) = LOWER(TRIM(s.E_mail_do_Comprador))
       WHERE l.utm_content IS NOT NULL AND l.utm_content != ''
         AND REGEXP_CONTAINS(TRIM(l.utm_content), r'^[0-9]+$')
         AND DATE(l.lead_register) BETWEEN @since AND @until
         AND DATE(s.Data_de_Aprova____o) BETWEEN @since AND @sales_until
         ${produtoFilter}
         ${statusFilter}
       GROUP BY 1`,
      dateParams,
    ),
    // last touch por campanha — leads no período, vendas na janela
    bqQuery(
      `WITH ranked AS (
         SELECT
           ${decodeUtm('l.utm_campaign')} AS campaign,
           LOWER(TRIM(l.lead_email)) AS email,
           ROW_NUMBER() OVER (
             PARTITION BY LOWER(TRIM(l.lead_email)), LOWER(TRIM(s.E_mail_do_Comprador))
             ORDER BY l.lead_register DESC
           ) AS rn
         FROM ${tLeads} l
         INNER JOIN ${tVendas} s
           ON LOWER(TRIM(l.lead_email)) = LOWER(TRIM(s.E_mail_do_Comprador))
         WHERE l.utm_campaign IS NOT NULL AND l.utm_campaign != ''
           AND DATE(l.lead_register) BETWEEN @since AND @until
           AND l.lead_register <= s.Data_de_Aprova____o
           AND DATE(s.Data_de_Aprova____o) BETWEEN @since AND @sales_until
           ${produtoFilter}
           ${statusFilter}
       )
       SELECT campaign AS key, COUNT(DISTINCT email) AS cnt
       FROM ranked WHERE rn = 1
       GROUP BY 1`,
      dateParams,
    ),
    // last touch por criativo — leads no período, vendas na janela
    bqQuery(
      `WITH ranked AS (
         SELECT
           ${decodeUtm('l.utm_campaign')} AS campaign,
           ${decodeUtm('l.utm_content')}  AS content,
           LOWER(TRIM(l.lead_email)) AS email,
           ROW_NUMBER() OVER (
             PARTITION BY LOWER(TRIM(l.lead_email)), LOWER(TRIM(s.E_mail_do_Comprador))
             ORDER BY l.lead_register DESC
           ) AS rn
         FROM ${tLeads} l
         INNER JOIN ${tVendas} s
           ON LOWER(TRIM(l.lead_email)) = LOWER(TRIM(s.E_mail_do_Comprador))
         WHERE l.utm_campaign IS NOT NULL AND l.utm_campaign != ''
           AND l.utm_content  IS NOT NULL AND l.utm_content  != ''
           AND DATE(l.lead_register) BETWEEN @since AND @until
           AND l.lead_register <= s.Data_de_Aprova____o
           AND DATE(s.Data_de_Aprova____o) BETWEEN @since AND @sales_until
           ${produtoFilter}
           ${statusFilter}
       )
       SELECT campaign, content, COUNT(DISTINCT email) AS cnt
       FROM ranked WHERE rn = 1
       GROUP BY 1, 2`,
      dateParams,
    ),
    // last touch por ad_id numérico — leads no período, vendas na janela
    bqQuery(
      `WITH ranked AS (
         SELECT
           TRIM(l.utm_content) AS ad_id,
           LOWER(TRIM(l.lead_email)) AS email,
           ROW_NUMBER() OVER (
             PARTITION BY LOWER(TRIM(l.lead_email)), LOWER(TRIM(s.E_mail_do_Comprador))
             ORDER BY l.lead_register DESC
           ) AS rn
         FROM ${tLeads} l
         INNER JOIN ${tVendas} s
           ON LOWER(TRIM(l.lead_email)) = LOWER(TRIM(s.E_mail_do_Comprador))
         WHERE l.utm_content IS NOT NULL AND l.utm_content != ''
           AND REGEXP_CONTAINS(TRIM(l.utm_content), r'^[0-9]+$')
           AND DATE(l.lead_register) BETWEEN @since AND @until
           AND l.lead_register <= s.Data_de_Aprova____o
           AND DATE(s.Data_de_Aprova____o) BETWEEN @since AND @sales_until
           ${produtoFilter}
           ${statusFilter}
       )
       SELECT ad_id, COUNT(DISTINCT email) AS cnt
       FROM ranked WHERE rn = 1
       GROUP BY 1`,
      dateParams,
    ),
    // receita e lag por campanha — leads no período, vendas na janela
    bqQuery(
      `SELECT ${decodeUtm('l.utm_campaign')} AS key,
              SUM(s.Valor_Pago_pelo_Comprador_Sem_Taxas_e_Impostos) AS receita,
              AVG(DATE_DIFF(s.Data_de_Aprova____o, DATE(l.lead_register), DAY)) AS lag_dias
       FROM ${tLeads} l
       INNER JOIN ${tVendas} s
         ON LOWER(TRIM(l.lead_email)) = LOWER(TRIM(s.E_mail_do_Comprador))
       WHERE l.utm_campaign IS NOT NULL AND l.utm_campaign != ''
         AND DATE(l.lead_register) BETWEEN @since AND @until
         AND DATE(s.Data_de_Aprova____o) BETWEEN @since AND @sales_until
         ${produtoFilter}
         ${statusFilter}
       GROUP BY 1`,
      dateParams,
    ),
    // vendas totais por produto_id no período (sem join de leads)
    produtoMap.length > 0
      ? bqQuery(
          `SELECT CAST(ID_do_Produto AS STRING) AS produto_id, COUNT(*) AS cnt
           FROM ${tVendas}
           WHERE DATE(Data_de_Aprova____o) BETWEEN @since AND @until
             AND Status IN ('APROVADO', 'COMPLETO')
           GROUP BY 1`,
          dateParams,
        )
      : Promise.resolve({ rows: [], totalRows: 0 }),
  ])

  // Chaves normalizadas (lowercase + trim) para match case-insensitive com nomes do Meta
  const norm = (s: string) => s.toLowerCase().trim()

  const leads: Record<string, number> = {}
  for (const r of campaignRows.rows) if (r.key) leads[norm(r.key)] = parseInt(r.cnt ?? '0')

  const content: Record<string, number> = {}
  for (const r of contentRows.rows) {
    if (r.content) content[`${norm(r.campaign ?? '')}|||${norm(r.content)}`] = parseInt(r.cnt ?? '0')
  }

  const vendas: Record<string, number> = {}
  for (const r of salesRows.rows) if (r.key) vendas[norm(r.key)] = parseInt(r.cnt ?? '0')

  const vendasContent: Record<string, number> = {}
  for (const r of salesContentRows.rows) {
    if (r.content) vendasContent[`${norm(r.campaign ?? '')}|||${norm(r.content)}`] = parseInt(r.cnt ?? '0')
  }

  const receita: Record<string, number> = {}
  const lagDias: Record<string, number> = {}
  for (const r of receitaRows.rows) {
    if (r.key) {
      receita[norm(r.key)] = parseFloat(r.receita ?? '0')
      lagDias[norm(r.key)] = parseFloat(r.lag_dias ?? '0')
    }
  }

  // Mapa ad_id (string numérica) → compradores únicos via UTM (funis Purchase com {{ad.id}})
  const vendasPorAdId: Record<string, number> = {}
  for (const r of vendasAdIdRows.rows) {
    if (r.ad_id) vendasPorAdId[String(r.ad_id).trim()] = parseInt(r.cnt ?? '0')
  }

  // Last touch por campanha
  const vendasLastCamp: Record<string, number> = {}
  for (const r of lastCampRows.rows) if (r.key) vendasLastCamp[norm(r.key)] = parseInt(r.cnt ?? '0')

  // Last touch por criativo
  const vendasLastContent: Record<string, number> = {}
  for (const r of lastContentRows.rows) {
    if (r.content) vendasLastContent[`${norm(r.campaign ?? '')}|||${norm(r.content)}`] = parseInt(r.cnt ?? '0')
  }

  // Last touch por ad_id numérico
  const vendasLastByAdId: Record<string, number> = {}
  for (const r of lastAdIdRows.rows) {
    if (r.ad_id) vendasLastByAdId[String(r.ad_id).trim()] = parseInt(r.cnt ?? '0')
  }

  // Monta mapa produto_id (string) → qty de vendas no período
  const vendasPorProduto: Record<string, number> = {}
  for (const r of vendasProdutoRows.rows) {
    if (r.produto_id) vendasPorProduto[String(r.produto_id).trim()] = parseInt(r.cnt ?? '0')
  }

  // Para cada entrada do produtoMap, soma as vendas dos produto_ids e associa ao prefixo
  const vendasTotais: Record<string, number> = {}
  for (const entry of produtoMap) {
    const total = entry.produto_ids.reduce((sum, id) => sum + (vendasPorProduto[String(id)] ?? 0), 0)
    vendasTotais[entry.prefixo] = total
  }

  // Queries por produto isolado — evita que vendas de produto A sejam atribuídas a campanhas de produto B
  const vendasByProduto:     Record<string, Record<string, number>> = {}
  const vendasLastByProduto: Record<string, Record<string, number>> = {}
  const receitaByProduto:    Record<string, Record<string, number>> = {}
  const lagDiasByProduto:    Record<string, Record<string, number>> = {}

  if (produtoMap.length > 1) {
    // Só executa queries isoladas quando há mais de 1 produto (se há só 1, vendas/receita/lagDias já estão corretos)
    await Promise.all(produtoMap.map(async entry => {
      const pFilter = `AND CAST(s.ID_do_Produto AS INT64) IN (${entry.produto_ids.join(', ')})`

      const [pvRows, plRows, prRows] = await Promise.all([
        bqQuery(
          `SELECT ${decodeUtm('l.utm_campaign')} AS key,
                  COUNT(DISTINCT LOWER(TRIM(l.lead_email))) AS cnt
           FROM ${tLeads} l
           INNER JOIN ${tVendas} s
             ON LOWER(TRIM(l.lead_email)) = LOWER(TRIM(s.E_mail_do_Comprador))
           WHERE l.utm_campaign IS NOT NULL AND l.utm_campaign != ''
             AND DATE(l.lead_register) BETWEEN @since AND @until
             AND DATE(s.Data_de_Aprova____o) BETWEEN @since AND @sales_until
             ${pFilter}
             ${statusFilter}
           GROUP BY 1`,
          dateParams,
        ),
        bqQuery(
          `WITH ranked AS (
             SELECT ${decodeUtm('l.utm_campaign')} AS campaign,
                    LOWER(TRIM(l.lead_email)) AS email,
                    ROW_NUMBER() OVER (
                      PARTITION BY LOWER(TRIM(l.lead_email)), LOWER(TRIM(s.E_mail_do_Comprador))
                      ORDER BY l.lead_register DESC
                    ) AS rn
             FROM ${tLeads} l
             INNER JOIN ${tVendas} s
               ON LOWER(TRIM(l.lead_email)) = LOWER(TRIM(s.E_mail_do_Comprador))
             WHERE l.utm_campaign IS NOT NULL AND l.utm_campaign != ''
               AND DATE(l.lead_register) BETWEEN @since AND @until
               AND l.lead_register <= s.Data_de_Aprova____o
               AND DATE(s.Data_de_Aprova____o) BETWEEN @since AND @sales_until
               ${pFilter}
               ${statusFilter}
           )
           SELECT campaign AS key, COUNT(DISTINCT email) AS cnt
           FROM ranked WHERE rn = 1
           GROUP BY 1`,
          dateParams,
        ),
        bqQuery(
          `SELECT ${decodeUtm('l.utm_campaign')} AS key,
                  SUM(s.Valor_Pago_pelo_Comprador_Sem_Taxas_e_Impostos) AS receita,
                  AVG(DATE_DIFF(s.Data_de_Aprova____o, DATE(l.lead_register), DAY)) AS lag_dias
           FROM ${tLeads} l
           INNER JOIN ${tVendas} s
             ON LOWER(TRIM(l.lead_email)) = LOWER(TRIM(s.E_mail_do_Comprador))
           WHERE l.utm_campaign IS NOT NULL AND l.utm_campaign != ''
             AND DATE(l.lead_register) BETWEEN @since AND @until
             AND DATE(s.Data_de_Aprova____o) BETWEEN @since AND @sales_until
             ${pFilter}
             ${statusFilter}
           GROUP BY 1`,
          dateParams,
        ),
      ])

      const vMap: Record<string, number> = {}
      for (const r of pvRows.rows) if (r.key) vMap[norm(r.key)] = parseInt(r.cnt ?? '0')
      vendasByProduto[entry.prefixo] = vMap

      const vlMap: Record<string, number> = {}
      for (const r of plRows.rows) if (r.key) vlMap[norm(r.key)] = parseInt(r.cnt ?? '0')
      vendasLastByProduto[entry.prefixo] = vlMap

      const rMap: Record<string, number> = {}
      const lMap: Record<string, number> = {}
      for (const r of prRows.rows) {
        if (r.key) {
          rMap[norm(r.key)] = parseFloat(r.receita ?? '0')
          lMap[norm(r.key)] = parseFloat(r.lag_dias ?? '0')
        }
      }
      receitaByProduto[entry.prefixo]  = rMap
      lagDiasByProduto[entry.prefixo]  = lMap
    }))
  }

  return { leads, content, vendas, vendasContent, vendasPorAdId, vendasLastCamp, vendasLastContent, vendasLastByAdId, receita, lagDias, vendasTotais, vendasByProduto, vendasLastByProduto, receitaByProduto, lagDiasByProduto }
}

// ─── Tipo de linha do relatório ───────────────────────────────────────────────

interface ReportRow {
  periodo_inicio:       string
  periodo_fim:          string
  data:                 string  // preenchido só com time_increment
  semana:               string  // preenchido só com time_increment=7
  conta:                string
  etapa:                string
  etapa_label:          string
  campanha:             string
  conjunto:             string
  anuncio:              string
  orcamento_diario:     string
  orcamento_total:      string
  investido:            string
  resultados:           string
  cpr:                  string
  taxa_conversao:       string
  impressoes:           string
  cliques:              string
  alcance:              string
  frequencia:           string
  cpm:                  string
  ctr:                  string
  views_3s:             string
  views_25pct:          string
  views_50pct:          string
  views_75pct:          string
  views_100pct:         string
  video_avg_time_watched: string
  cpc:                  string
  hook_rate:            string
  hold_rate:            string
  thruplay_rate:        string
  quality_ranking:            string
  engagement_rate_ranking:    string
  conversion_rate_ranking:    string
  status_entrega:             string
  dias_desde_criacao:         string
  headline_texto:             string
  corpo_texto:                string
  description_texto:          string
  cta_botao:                  string
  thumbnail_url:              string
  landing_url_real:           string
  formato_criativo:           string
  receita_reais:              string
  roas_real:                  string
  ticket_medio_real:          string
  lag_dias_conversao_medio:   string
  leads_reais:          string  // leads únicos via UTM (BigQuery) — prioridade para análise
  cpl_real:             string  // investido / leads_reais
  vendas_reais:         string  // compradores únicos via UTM (BigQuery) — prioridade para análise
  cpv_real:             string  // investido / vendas_reais
  vendas_totais_periodo: string  // vendas do produto no período, sem join de lead
  produto:               string  // label do produto vendido (ex: "Imersão Enare"), ou "" se não mapeado
  vendas_any:            string  // any touch: compradores que tocaram neste anúncio/conjunto/campanha
  cpv_any:               string  // investido / vendas_any
  vendas_last:           string  // last touch: compradores cujo último toque foi neste anúncio/conjunto/campanha
  cpv_last:              string  // investido / vendas_last
  _debug_contentKey?:    string
  variacao_periodo_anterior?: VariacaoPeriodo
}

interface VariacaoPeriodo {
  investido:   string
  resultados:  string
  cpr:         string
  cpm:         string
  ctr:         string
  frequencia:  string
  leads_reais: string
  cpl_real:    string
}

// ─── Variação período anterior (opt-in via ?include=variacao) ────────────────

function prevPeriod(since: string, until: string): { since: string; until: string } {
  const s = new Date(since)
  const u = new Date(until)
  const days = Math.round((u.getTime() - s.getTime()) / 86400000) + 1
  const prevUntil = new Date(s.getTime() - 86400000)
  const prevSince = new Date(prevUntil.getTime() - (days - 1) * 86400000)
  return {
    since: prevSince.toISOString().split('T')[0],
    until: prevUntil.toISOString().split('T')[0],
  }
}

function varPct(current: number, previous: number): string {
  if (previous === 0 || isNaN(previous)) return ''
  const pct = ((current - previous) / previous) * 100
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}`
}

function emptyVariacao(): VariacaoPeriodo {
  return { investido: '', resultados: '', cpr: '', cpm: '', ctr: '', frequencia: '', leads_reais: '', cpl_real: '' }
}

// Agrega métricas da janela anterior por chave campanha|||conjunto|||anuncio
async function fetchPrevUtmCounts(since: string, until: string): Promise<UtmCounts> {
  return fetchUtmCounts(since, until)
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const providedToken = typeof req.query.token === 'string' ? req.query.token : ''
  const validToken    = process.env.DASHBOARD_TOKEN ?? ''
  const validAdmin    = process.env.DASHBOARD_TOKEN_ADMIN ?? ''
  if (!providedToken || (providedToken !== validToken && providedToken !== validAdmin)) {
    return res.status(401).json({ error: 'Token inválido. Passe ?token=SEU_TOKEN' })
  }

  const accessToken = process.env.META_ACCESS_TOKEN ?? ''
  if (!accessToken) return res.status(503).json({ error: 'META_ACCESS_TOKEN não configurado' })

  const account = typeof req.query.account === 'string' ? req.query.account : 'conta1'
  if (!ACCOUNT_IDS[account]) return res.status(400).json({ error: 'account inválido (conta1 | conta2)' })

  const accountViews  = account === 'conta1' ? CONTA1_VIEWS : CONTA2_VIEWS
  const viewsParam    = typeof req.query.views === 'string' ? req.query.views : 'all'
  const selectedViews = viewsParam === 'all'
    ? accountViews
    : viewsParam.split(',').map(v => v.trim()).filter(v => NAME_FILTERS[v] && accountViews.includes(v))

  if (selectedViews.length === 0) {
    return res.status(400).json({ error: `Nenhuma view válida. Opções: ${accountViews.join(', ')}` })
  }

  // Carrega filtros customizados e mapa de produtos do Supabase em paralelo
  const [customFilters, produtoMap] = await Promise.all([
    loadCustomFilters(account, selectedViews),
    loadProdutoMap(account),
  ])
  const effectiveFilters: Record<string, NameFilter> = {}
  for (const v of selectedViews) {
    effectiveFilters[v] = customFilters[v] ?? NAME_FILTERS[v]
  }

  const re    = /^\d{4}-\d{2}-\d{2}$/
  const today = new Date().toISOString().split('T')[0]
  const since = typeof req.query.since === 'string' && re.test(req.query.since)
    ? req.query.since
    : new Date(new Date().setDate(1)).toISOString().split('T')[0]
  const until = typeof req.query.until === 'string' && re.test(req.query.until)
    ? req.query.until
    : today

  const format = typeof req.query.format === 'string' && req.query.format === 'json' ? 'json' : 'csv'
  const level  = typeof req.query.level  === 'string' && ['campaign', 'adset', 'ad'].includes(req.query.level)
    ? req.query.level : 'adset'

  const tiRaw        = typeof req.query.time_increment === 'string' ? req.query.time_increment : ''
  const timeIncrement = tiRaw === '1' ? 1 : tiRaw === '7' ? 7 : null

  const includeParam    = typeof req.query.include === 'string' ? req.query.include.split(',') : []
  const includeVariacao = includeParam.includes('variacao')

  const fieldsParam = typeof req.query.fields === 'string'
    && ['minimal', 'standard', 'full'].includes(req.query.fields)
    ? req.query.fields as 'minimal' | 'standard' | 'full'
    : 'standard'

  const forceRefresh = req.query.refresh === 'true' || req.query.cache === 'false' || req.query.nocache === '1'

  const acctId       = ACCOUNT_IDS[account]
  const timeRange    = JSON.stringify({ since, until })
  const closedPeriod = until < today

  // Cache key — inclui todos os parâmetros que afetam o resultado
  const cacheParams = { account, views: selectedViews.join(','), since, until, level, fields: fieldsParam, time_increment: String(timeIncrement ?? '') }
  const cacheKey    = makeCacheKey(cacheParams)

  // Campos de insights por nível de detalhe
  const FIELDS_MINIMAL  = ['campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'spend', 'actions']
  const FIELDS_STANDARD = [...FIELDS_MINIMAL, 'impressions', 'clicks', 'reach', 'frequency', 'cpm', 'ctr']
  const FIELDS_FULL     = [...FIELDS_STANDARD, 'video_thruplay_watched_actions', 'video_p25_watched_actions']

  const insightFieldSet = fieldsParam === 'minimal' ? FIELDS_MINIMAL : fieldsParam === 'full' ? FIELDS_FULL : FIELDS_STANDARD
  const insightFields   = insightFieldSet.join(',')

  try {
    // ── Cache read ────────────────────────────────────────────────────────────
    if (!forceRefresh) {
      const cached = await cacheGet(cacheKey)
      if (cached && !cached.stale) {
        const payload = cached.data
        if (format === 'json') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('X-Cache', 'HIT')
          return res.json(payload)
        }
        // CSV from cached JSON payload
        if (payload?.dados) {
          type CsvField = Exclude<keyof ReportRow, 'variacao_periodo_anterior'>
          const headers: CsvField[] = [
            'periodo_inicio', 'periodo_fim', 'data', 'semana',
            'conta', 'etapa', 'etapa_label',
            'campanha', 'conjunto', 'anuncio',
            'orcamento_diario', 'orcamento_total', 'investido',
            'resultados', 'cpr', 'taxa_conversao',
            'impressoes', 'cliques', 'alcance', 'frequencia', 'cpm', 'ctr',
            'cpc',
            'views_3s', 'views_25pct', 'views_50pct', 'views_75pct', 'views_100pct', 'video_avg_time_watched',
            'hook_rate', 'hold_rate', 'thruplay_rate',
            'quality_ranking', 'engagement_rate_ranking', 'conversion_rate_ranking', 'status_entrega', 'dias_desde_criacao',
            'receita_reais', 'roas_real', 'ticket_medio_real', 'lag_dias_conversao_medio',
            'leads_reais', 'cpl_real', 'vendas_reais', 'cpv_real', 'vendas_totais_periodo', 'produto',
      'vendas_any', 'cpv_any', 'vendas_last', 'cpv_last',
          ]
          const csvLines = [
            headers.join(','),
            ...payload.dados.map((r: any) => headers.map((h: string) => csvEscape(r[h] ?? '')).join(',')),
          ]
          res.setHeader('Content-Type', 'text/csv; charset=utf-8')
          res.setHeader('Content-Disposition', `attachment; filename="relatorio_${since}_${until}.csv"`)
          res.setHeader('X-Cache', 'HIT')
          return res.send('﻿' + csvLines.join('\r\n'))
        }
      }
    }

    // ── Busca insights (adset e ad) ───────────────────────────────────────────

    const adsetInsightUrl = new URL(`${META_BASE}/${acctId}/insights`)
    adsetInsightUrl.searchParams.set('level',        'adset')
    adsetInsightUrl.searchParams.set('fields',       insightFields)
    adsetInsightUrl.searchParams.set('time_range',   timeRange)
    adsetInsightUrl.searchParams.set('access_token', accessToken)
    adsetInsightUrl.searchParams.set('limit',        '200')
    if (timeIncrement) adsetInsightUrl.searchParams.set('time_increment', String(timeIncrement))

    const adInsightFields = [
      'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name',
      'spend', 'actions',
      'impressions', 'clicks', 'reach', 'frequency', 'cpm', 'ctr',
      'video_thruplay_watched_actions', 'video_p25_watched_actions',
    ].join(',')

    const adInsightUrl = new URL(`${META_BASE}/${acctId}/insights`)
    adInsightUrl.searchParams.set('level',        'ad')
    adInsightUrl.searchParams.set('fields',       adInsightFields)
    adInsightUrl.searchParams.set('time_range',   timeRange)
    adInsightUrl.searchParams.set('access_token', accessToken)
    adInsightUrl.searchParams.set('limit',        '500')
    if (timeIncrement) adInsightUrl.searchParams.set('time_increment', String(timeIncrement))

    const adsetsUrl = new URL(`${META_BASE}/${acctId}/adsets`)
    adsetsUrl.searchParams.set('fields',       'id,daily_budget,lifetime_budget,optimization_goal,promoted_object,campaign_id')
    adsetsUrl.searchParams.set('access_token', accessToken)
    adsetsUrl.searchParams.set('limit',        '500')

    const adsMetaUrl = new URL(`${META_BASE}/${acctId}/ads`)
    adsMetaUrl.searchParams.set('fields',       'id,effective_status,created_time')
    adsMetaUrl.searchParams.set('access_token', accessToken)
    adsMetaUrl.searchParams.set('limit',        '500')

    const campaignUrl = new URL(`${META_BASE}/${acctId}/campaigns`)
    campaignUrl.searchParams.set('fields',       'id,objective')
    campaignUrl.searchParams.set('access_token', accessToken)
    campaignUrl.searchParams.set('limit',        '500')

    const needsUtm = selectedViews.some(v => VIEWS_WITH_UTM.has(v))
    const prev     = prevPeriod(since, until)

    const prevAdsetInsightUrl = includeVariacao ? (() => {
      const u = new URL(`${META_BASE}/${acctId}/insights`)
      u.searchParams.set('level',        'adset')
      u.searchParams.set('fields',       insightFields)
      u.searchParams.set('time_range',   JSON.stringify({ since: prev.since, until: prev.until }))
      u.searchParams.set('access_token', accessToken)
      u.searchParams.set('limit',        '200')
      return u
    })() : null

    const [adsetInsights, adInsights, adsetsData, campaignsData, adsMeta, utmCounts, prevUtmCounts, prevAdsetInsights] = await Promise.all([
      metaGetAll(adsetInsightUrl),
      metaGetAll(adInsightUrl),
      metaGetAll(adsetsUrl),
      metaGetAll(campaignUrl),
      metaGetAll(adsMetaUrl),
      needsUtm ? fetchUtmCounts(since, until, produtoMap) : Promise.resolve({ leads: {}, content: {}, vendas: {}, vendasContent: {}, vendasPorAdId: {}, vendasLastCamp: {}, vendasLastContent: {}, vendasLastByAdId: {}, receita: {}, lagDias: {}, vendasTotais: {} } as UtmCounts),
      needsUtm && includeVariacao ? fetchPrevUtmCounts(prev.since, prev.until) : Promise.resolve({ leads: {}, content: {}, vendas: {}, vendasContent: {}, vendasPorAdId: {}, vendasLastCamp: {}, vendasLastContent: {}, vendasLastByAdId: {}, receita: {}, lagDias: {}, vendasTotais: {} } as UtmCounts),
      prevAdsetInsightUrl ? metaGetAll(prevAdsetInsightUrl) : Promise.resolve([] as any[]),
    ])

    // ── Mapas auxiliares ──────────────────────────────────────────────────────

    const campaignObjective = new Map<string, string>()
    for (const c of campaignsData) campaignObjective.set(c.id, c.objective ?? '')

    const adsetMeta = new Map<string, { daily: number | null; lifetime: number | null; resultTypes: string[] }>()
    for (const s of adsetsData) {
      const obj = campaignObjective.get(s.campaign_id) ?? ''
      adsetMeta.set(s.id, {
        daily:       s.daily_budget    ? Number(s.daily_budget) / 100    : null,
        lifetime:    s.lifetime_budget ? Number(s.lifetime_budget) / 100 : null,
        resultTypes: getResultTypes(s, obj),
      })
    }

    // Mapa campanha_name → totais do período anterior (apenas quando includeVariacao)
    type PrevTotals = { spend: number; results: number; impressions: number; clicks: number; reach: number }
    const prevCampMap = new Map<string, PrevTotals>()
    if (includeVariacao) {
      for (const row of prevAdsetInsights) {
        const key   = row.campaign_name as string
        const entry = prevCampMap.get(key) ?? { spend: 0, results: 0, impressions: 0, clicks: 0, reach: 0 }
        const rt    = adsetMeta.get(row.adset_id)?.resultTypes ?? ['lead']
        entry.spend       += Number(row.spend ?? 0)
        entry.results     += actionVal(row.actions, ...rt)
        entry.impressions += Number(row.impressions ?? 0)
        entry.clicks      += Number(row.clicks ?? 0)
        entry.reach       += Number(row.reach ?? 0)
        prevCampMap.set(key, entry)
      }
    }

    // Mapa ad_id → metadados do ad (status, criativo)
    const todayDate = new Date()
    interface AdMeta { status: string; dias: string; headline: string; corpo: string; description: string; cta: string; thumbnail: string; landing_url: string; formato: string }
    const adStatusMap = new Map<string, AdMeta>()
    for (const a of adsMeta) {
      const dias = a.created_time
        ? String(Math.round((todayDate.getTime() - new Date(a.created_time).getTime()) / 86400000))
        : ''
      const cr   = a.creative ?? {}
      const link = cr.object_story_spec?.link_data ?? {}
      const video = cr.object_story_spec?.video_data ?? {}
      const isCarousel = Array.isArray(cr.object_story_spec?.template_data?.child_attachments) ||
                         Array.isArray(cr.asset_feed_spec?.bodies)
      const formato = cr.video_id || link.child_attachments === undefined && video.video_id
        ? 'video'
        : isCarousel ? 'carousel'
        : (link.link || cr.object_story_spec) ? 'single_image'
        : 'single_image'
      adStatusMap.set(a.id, {
        status:      (a.effective_status as string) ?? '',
        dias,
        headline:    (cr.title ?? link.name ?? video.title ?? '') as string,
        corpo:       (cr.body  ?? link.message ?? video.message ?? '') as string,
        description: (link.description ?? '') as string,
        cta:         (link.call_to_action?.type ?? video.call_to_action?.type ?? '') as string,
        thumbnail:   (cr.thumbnail_url ?? link.picture ?? '') as string,
        landing_url: (link.link ?? '') as string,
        formato,
      })
    }

    // Agrupa anúncios por adsetId (e data se time_increment)
    const adsByAdset = new Map<string, any[]>()
    for (const ad of adInsights) {
      const key = timeIncrement ? `${ad.adset_id}__${ad.date_start ?? ''}` : ad.adset_id
      const list = adsByAdset.get(key) ?? []
      list.push(ad)
      adsByAdset.set(key, list)
    }

    // ── Helpers para métricas de alcance/impressão ────────────────────────────

    function getReachMetrics(row: any, spend: number) {
      const impressoes = String(Number(row.impressions ?? 0))
      const cliques    = String(Number(row.clicks ?? 0))
      const alcance    = String(Number(row.reach ?? 0))
      const frequencia = row.frequency ? Number(row.frequency).toFixed(2) : ''
      const imp        = Number(row.impressions ?? 0)
      const cpmVal     = row.cpm ? Number(row.cpm).toFixed(2)
                        : (imp > 0 ? ((spend / imp) * 1000).toFixed(2) : '')
      const ctrVal     = row.ctr ? Number(row.ctr).toFixed(2) : ''
      return { impressoes, cliques, alcance, frequencia, cpm: cpmVal, ctr: ctrVal }
    }

    function videoVal(row: any, field: string): string {
      const v = Number(row[field]?.[0]?.value ?? 0)
      return v > 0 ? String(v) : ''
    }

    function div2(a: number, b: number): string {
      return b > 0 && a !== 0 ? (a / b).toFixed(2) : ''
    }

    function pct2(num: number, den: number): string {
      return den > 0 && num !== 0 ? ((num / den) * 100).toFixed(2) : ''
    }

    function getDateFields(row: any) {
      if (!timeIncrement) return { data: '', semana: '' }
      const d = row.date_start ?? ''
      return {
        data:   d,
        semana: timeIncrement === 7 ? d : '',
      }
    }

    // ── Constrói linhas ───────────────────────────────────────────────────────

    const rows: ReportRow[] = []

    for (const viewId of selectedViews) {
      const filter    = effectiveFilters[viewId]
      const viewLabel = VIEW_LABELS[viewId] ?? viewId
      const isVideo   = viewId === 'etapa3'

      // Agrupa por campanha → adset (considerando data se time_increment)
      type CampEntry = { name: string; adsets: any[] }
      const campMap = new Map<string, CampEntry>()

      for (const row of adsetInsights) {
        if (!matchesFilter(row.campaign_name, filter)) continue
        const campKey = timeIncrement ? `${row.campaign_id}__${row.date_start ?? ''}` : row.campaign_id
        if (!campMap.has(campKey)) campMap.set(campKey, { name: row.campaign_name, adsets: [] })
        campMap.get(campKey)!.adsets.push(row)
      }

      for (const [, camp] of campMap) {
        const { data: campData, semana: campSemana } = getDateFields(camp.adsets[0] ?? {})

        const hasUtm = VIEWS_WITH_UTM.has(viewId)

        // Linha de campanha (totais)
        if (level === 'campaign' || level === 'adset' || level === 'ad') {
          const campSpend   = camp.adsets.reduce((s, r) => s + Number(r.spend ?? 0), 0)
          const campResults = camp.adsets.reduce((s, r) => {
            const rt = adsetMeta.get(r.adset_id)?.resultTypes ?? ['lead']
            return s + actionVal(r.actions, ...rt)
          }, 0)
          const campImp       = camp.adsets.reduce((s, r) => s + Number(r.impressions ?? 0), 0)
          const campClk       = camp.adsets.reduce((s, r) => s + Number(r.clicks ?? 0), 0)
          const campAlc       = camp.adsets.reduce((s, r) => s + Number(r.reach ?? 0), 0)
          const campKey       = camp.name.toLowerCase().trim()
          const campLeads     = hasUtm ? (utmCounts.leads[campKey] ?? 0) : 0
          const campProdEntry = produtoMap.find(e => campKey.includes(e.prefixo))
          const campPrefixo   = campProdEntry?.prefixo
          // Se há múltiplos produtos e a campanha pertence a um produto específico, usa mapa isolado
          const campVendasMap = campPrefixo && Object.keys(utmCounts.vendasByProduto).length > 0
            ? (utmCounts.vendasByProduto[campPrefixo] ?? utmCounts.vendas)
            : utmCounts.vendas
          const campLastMap   = campPrefixo && Object.keys(utmCounts.vendasLastByProduto).length > 0
            ? (utmCounts.vendasLastByProduto[campPrefixo] ?? utmCounts.vendasLastCamp)
            : utmCounts.vendasLastCamp
          const campReceitaMap = campPrefixo && Object.keys(utmCounts.receitaByProduto).length > 0
            ? (utmCounts.receitaByProduto[campPrefixo] ?? utmCounts.receita)
            : utmCounts.receita
          const campLagMap    = campPrefixo && Object.keys(utmCounts.lagDiasByProduto).length > 0
            ? (utmCounts.lagDiasByProduto[campPrefixo] ?? utmCounts.lagDias)
            : utmCounts.lagDias
          const campVendas    = hasUtm ? (campVendasMap[campKey] ?? 0) : 0

          let variacao: VariacaoPeriodo | undefined
          if (includeVariacao) {
            const p = prevCampMap.get(camp.name)
            if (!p || p.spend === 0) {
              variacao = emptyVariacao()
            } else {
              const prevLeads  = hasUtm ? (prevUtmCounts.leads[campKey] ?? 0) : 0
              const prevCplNum = prevLeads > 0 ? p.spend / prevLeads : 0
              const currCpr    = campResults > 0 ? campSpend / campResults : 0
              const prevCpr    = p.results   > 0 ? p.spend  / p.results   : 0
              const currCpm    = campImp > 0 ? (campSpend / campImp) * 1000 : 0
              const prevCpm    = p.impressions > 0 ? (p.spend / p.impressions) * 1000 : 0
              const currCtr    = campImp > 0 ? (campClk / campImp) * 100 : 0
              const prevCtr    = p.impressions > 0 ? (p.clicks / p.impressions) * 100 : 0
              const currFreq   = campImp > 0 && campAlc > 0 ? campImp / campAlc : 0
              const prevFreq   = p.impressions > 0 && p.reach > 0 ? p.impressions / p.reach : 0
              const currCpl    = campLeads > 0 ? campSpend / campLeads : 0
              variacao = {
                investido:   varPct(campSpend,  p.spend),
                resultados:  varPct(campResults, p.results),
                cpr:         varPct(currCpr,     prevCpr),
                cpm:         varPct(currCpm,     prevCpm),
                ctr:         varPct(currCtr,     prevCtr),
                frequencia:  varPct(currFreq,    prevFreq),
                leads_reais: varPct(campLeads,   prevLeads),
                cpl_real:    varPct(currCpl,     prevCplNum),
              }
            }
          }

          rows.push({
            periodo_inicio:   since,
            periodo_fim:      until,
            data:             campData,
            semana:           campSemana,
            conta:            account,
            etapa:            viewId,
            etapa_label:      viewLabel,
            campanha:         camp.name,
            conjunto:         '',
            anuncio:          '',
            orcamento_diario: '',
            orcamento_total:  '',
            investido:        campSpend.toFixed(2),
            resultados:       campResults.toString(),
            cpr:              campResults > 0 ? (campSpend / campResults).toFixed(2) : '',
            taxa_conversao:   '',
            impressoes:       String(campImp),
            cliques:          String(campClk),
            alcance:          String(campAlc),
            frequencia:       campImp > 0 && campAlc > 0 ? (campImp / campAlc).toFixed(2) : '',
            cpm:              campImp > 0 ? ((campSpend / campImp) * 1000).toFixed(2) : '',
            ctr:              campImp > 0 ? ((campClk / campImp) * 100).toFixed(2) : '',
            views_3s:               isVideo ? String(camp.adsets.reduce((s, r) => s + Number(r.video_thruplay_watched_actions?.[0]?.value ?? 0), 0)) : '',
            views_25pct:            isVideo ? String(camp.adsets.reduce((s, r) => s + Number(r.video_p25_watched_actions?.[0]?.value ?? 0), 0)) : '',
            views_50pct:            '',
            views_75pct:            '',
            views_100pct:           '',
            video_avg_time_watched: '',
            cpc:                    div2(campSpend, campClk),
            hook_rate:              '',
            hold_rate:              '',
            thruplay_rate:          '',
            quality_ranking:            '',
            engagement_rate_ranking:    '',
            conversion_rate_ranking:    '',
            status_entrega:             '',
            dias_desde_criacao:         '',
            headline_texto:             '',
            corpo_texto:                '',
            description_texto:          '',
            cta_botao:                  '',
            thumbnail_url:              '',
            landing_url_real:           '',
            formato_criativo:           '',
            receita_reais:            (() => { const r = campReceitaMap[campKey]; return r > 0 ? r.toFixed(2) : '' })(),
            roas_real:                (() => { const r = campReceitaMap[campKey]; return r > 0 && campSpend > 0 ? (r / campSpend).toFixed(2) : '' })(),
            ticket_medio_real:        (() => { const r = campReceitaMap[campKey]; const v = campVendas; return r > 0 && v > 0 ? (r / v).toFixed(2) : '' })(),
            lag_dias_conversao_medio: (() => { const l = campLagMap[campKey]; return l > 0 ? l.toFixed(1) : '' })(),
            leads_reais:            hasUtm ? String(campLeads) : '',
            cpl_real:               hasUtm && campLeads > 0 ? (campSpend / campLeads).toFixed(2) : '',
            vendas_reais:           hasUtm ? String(campVendas) : '',
            cpv_real:               hasUtm && campVendas > 0 ? (campSpend / campVendas).toFixed(2) : '',
            vendas_totais_periodo:  (() => { if (!campProdEntry) return ''; const t = utmCounts.vendasTotais[campProdEntry.prefixo] ?? 0; return t > 0 ? String(t) : '' })(),
            produto:                campProdEntry?.label ?? '',
            vendas_any:             hasUtm ? String(campVendas) : '',
            cpv_any:                hasUtm && campVendas > 0 ? (campSpend / campVendas).toFixed(2) : '',
            vendas_last:            (() => { const v = campLastMap[campKey] ?? 0; return hasUtm ? String(v) : '' })(),
            cpv_last:               (() => { const v = campLastMap[campKey] ?? 0; return hasUtm && v > 0 ? (campSpend / v).toFixed(2) : '' })(),
            variacao_periodo_anterior: variacao,
          })
        }

        if (level === 'adset' || level === 'ad') {
          for (const adsetRow of camp.adsets) {
            const meta    = adsetMeta.get(adsetRow.adset_id)
            const spend   = Number(adsetRow.spend ?? 0)
            const rt      = meta?.resultTypes ?? ['lead']
            const results = isVideo ? 0 : actionVal(adsetRow.actions, ...rt)
            const lpv     = actionVal(adsetRow.actions, 'landing_page_view')
            const rm      = getReachMetrics(adsetRow, spend)
            const df      = getDateFields(adsetRow)
            // adset: soma de todos os ads do conjunto usando chave campaign|||ad_name
            const adsetAdKey = timeIncrement ? `${adsetRow.adset_id}__${adsetRow.date_start ?? ''}` : adsetRow.adset_id
            const adsetAds   = adsByAdset.get(adsetAdKey) ?? []
            const campNorm   = camp.name.toLowerCase().trim()
            const adsetLeads = hasUtm
              ? adsetAds.reduce((s: number, a: any) => s + (utmCounts.content[`${campNorm}|||${a.ad_name.toLowerCase().trim()}`] ?? 0), 0)
              : 0
            // Vendas por adset: soma de todos os ads do conjunto
            const adsetAdIds = adsetAds.map((a: any) => String(a.ad_id))
            const adsetVendasById = hasUtm
              ? adsetAdIds.reduce((s: number, id: string) => s + (utmCounts.vendasPorAdId[id] ?? 0), 0)
              : 0
            const adsetVendasByKey = hasUtm
              ? adsetAds.reduce((s: number, a: any) => s + (utmCounts.vendasContent[`${campNorm}|||${a.ad_name.toLowerCase().trim()}`] ?? 0), 0)
              : 0
            const adsetVendas = adsetVendasById > 0 ? adsetVendasById : adsetVendasByKey

            rows.push({
              periodo_inicio:   since,
              periodo_fim:      until,
              data:             df.data,
              semana:           df.semana,
              conta:            account,
              etapa:            viewId,
              etapa_label:      viewLabel,
              campanha:         camp.name,
              conjunto:         adsetRow.adset_name,
              anuncio:          '',
              orcamento_diario: meta?.daily    != null ? meta.daily.toFixed(2)    : '',
              orcamento_total:  meta?.lifetime != null ? meta.lifetime.toFixed(2) : '',
              investido:        spend.toFixed(2),
              resultados:       results.toString(),
              cpr:              results > 0 ? (spend / results).toFixed(2) : '',
              taxa_conversao:   lpv > 0 ? ((results / lpv) * 100).toFixed(1) : '',
              ...rm,
              views_3s:               isVideo ? videoVal(adsetRow, 'video_thruplay_watched_actions') : '',
              views_25pct:            isVideo ? videoVal(adsetRow, 'video_p25_watched_actions') : '',
              views_50pct:            '',
              views_75pct:            '',
              views_100pct:           '',
              video_avg_time_watched: '',
              cpc:                    div2(spend, Number(adsetRow.clicks ?? 0)),
              hook_rate:              '',
              hold_rate:              '',
              thruplay_rate:          '',
              quality_ranking:            '',
              engagement_rate_ranking:    '',
              conversion_rate_ranking:    '',
              status_entrega:             '',
              dias_desde_criacao:         '',
              headline_texto:             '',
              corpo_texto:                '',
              description_texto:          '',
              cta_botao:                  '',
              thumbnail_url:              '',
              landing_url_real:           '',
              formato_criativo:           '',
              receita_reais:            '',
              roas_real:                '',
              ticket_medio_real:        '',
              lag_dias_conversao_medio: '',
              leads_reais:            hasUtm ? String(adsetLeads) : '',
              cpl_real:               hasUtm && adsetLeads > 0 ? (spend / adsetLeads).toFixed(2) : '',
              vendas_reais:           hasUtm ? String(adsetVendas) : '',
              cpv_real:               hasUtm && adsetVendas > 0 ? (spend / adsetVendas).toFixed(2) : '',
              vendas_totais_periodo:  '',
              produto:                '',
              vendas_any:             hasUtm ? String(adsetVendas) : '',
              cpv_any:                hasUtm && adsetVendas > 0 ? (spend / adsetVendas).toFixed(2) : '',
              vendas_last:            (() => { const v = adsetAds.reduce((s: number, a: any) => s + (utmCounts.vendasLastContent[`${campNorm}|||${a.ad_name.toLowerCase().trim()}`] ?? 0), 0); return hasUtm ? String(v) : '' })(),
              cpv_last:               (() => { const v = adsetAds.reduce((s: number, a: any) => s + (utmCounts.vendasLastContent[`${campNorm}|||${a.ad_name.toLowerCase().trim()}`] ?? 0), 0); return hasUtm && v > 0 ? (spend / v).toFixed(2) : '' })(),
            })

            if (level === 'ad') {
              const adKey = timeIncrement ? `${adsetRow.adset_id}__${adsetRow.date_start ?? ''}` : adsetRow.adset_id
              for (const ad of adsByAdset.get(adKey) ?? []) {
                const adSpend   = Number(ad.spend ?? 0)
                const adResults = actionVal(ad.actions, ...rt)
                const adRm      = getReachMetrics(ad, adSpend)
                const adDf      = getDateFields(ad)
                const contentKey  = `${camp.name.toLowerCase().trim()}|||${ad.ad_name.toLowerCase().trim()}`
                const adLeads    = hasUtm ? (utmCounts.content[contentKey] ?? 0) : 0
                // Vendas por ad: tenta primeiro por ad_id direto (funis Purchase com {{ad.id}}),
                // fallback para contentKey (funis Lead com utm_content = ad_name)
                const adVendasById  = hasUtm ? (utmCounts.vendasPorAdId[String(ad.ad_id)] ?? 0) : 0
                const adVendasByKey = hasUtm ? (utmCounts.vendasContent[contentKey] ?? 0) : 0
                const adVendas      = adVendasById > 0 ? adVendasById : adVendasByKey
                rows.push({
                  periodo_inicio:   since,
                  periodo_fim:      until,
                  data:             adDf.data,
                  semana:           adDf.semana,
                  conta:            account,
                  etapa:            viewId,
                  etapa_label:      viewLabel,
                  campanha:         camp.name,
                  conjunto:         adsetRow.adset_name,
                  anuncio:          ad.ad_name,
                  orcamento_diario: '',
                  orcamento_total:  '',
                  investido:        adSpend.toFixed(2),
                  resultados:       adResults.toString(),
                  cpr:              adResults > 0 ? (adSpend / adResults).toFixed(2) : '',
                  taxa_conversao:   '',
                  ...adRm,
                  views_3s:               videoVal(ad, 'video_thruplay_watched_actions'),
                  views_25pct:            videoVal(ad, 'video_p25_watched_actions'),
                  views_50pct:            videoVal(ad, 'video_p50_watched_actions'),
                  views_75pct:            videoVal(ad, 'video_p75_watched_actions'),
                  views_100pct:           videoVal(ad, 'video_p100_watched_actions'),
                  video_avg_time_watched: videoVal(ad, 'video_avg_time_watched_actions'),
                  cpc:                    div2(adSpend, Number(ad.clicks ?? 0)),
                  hook_rate:              pct2(Number(ad.video_thruplay_watched_actions?.[0]?.value ?? 0), Number(ad.impressions ?? 0)),
                  hold_rate:              pct2(Number(ad.video_p25_watched_actions?.[0]?.value ?? 0), Number(ad.video_thruplay_watched_actions?.[0]?.value ?? 0)),
                  thruplay_rate:          pct2(Number(ad.video_p100_watched_actions?.[0]?.value ?? 0), Number(ad.video_thruplay_watched_actions?.[0]?.value ?? 0)),
                  quality_ranking:            (ad.quality_ranking as string) ?? '',
                  engagement_rate_ranking:    (ad.engagement_rate_ranking as string) ?? '',
                  conversion_rate_ranking:    (ad.conversion_rate_ranking as string) ?? '',
                  status_entrega:             adStatusMap.get(ad.ad_id)?.status ?? '',
                  dias_desde_criacao:         adStatusMap.get(ad.ad_id)?.dias ?? '',
                  headline_texto:             adStatusMap.get(ad.ad_id)?.headline ?? '',
                  corpo_texto:                adStatusMap.get(ad.ad_id)?.corpo ?? '',
                  description_texto:          adStatusMap.get(ad.ad_id)?.description ?? '',
                  cta_botao:                  adStatusMap.get(ad.ad_id)?.cta ?? '',
                  thumbnail_url:              adStatusMap.get(ad.ad_id)?.thumbnail ?? '',
                  landing_url_real:           adStatusMap.get(ad.ad_id)?.landing_url ?? '',
                  formato_criativo:           adStatusMap.get(ad.ad_id)?.formato ?? '',
                  receita_reais:            '',
                  roas_real:                '',
                  ticket_medio_real:        '',
                  lag_dias_conversao_medio: '',
                  leads_reais:            hasUtm ? String(adLeads) : '',
                  cpl_real:               hasUtm && adLeads > 0 ? (adSpend / adLeads).toFixed(2) : '',
                  vendas_reais:           hasUtm ? String(adVendas) : '',
                  cpv_real:               hasUtm && adVendas > 0 ? (adSpend / adVendas).toFixed(2) : '',
                  vendas_totais_periodo:  '',
                  produto:                '',
                  vendas_any:             hasUtm ? String(adVendas) : '',
                  cpv_any:                hasUtm && adVendas > 0 ? (adSpend / adVendas).toFixed(2) : '',
                  vendas_last:            (() => { const byId = utmCounts.vendasLastByAdId[String(ad.ad_id)] ?? 0; const v = byId > 0 ? byId : (utmCounts.vendasLastContent[contentKey] ?? 0); return hasUtm ? String(v) : '' })(),
                  cpv_last:               (() => { const byId = utmCounts.vendasLastByAdId[String(ad.ad_id)] ?? 0; const v = byId > 0 ? byId : (utmCounts.vendasLastContent[contentKey] ?? 0); return hasUtm && v > 0 ? (adSpend / v).toFixed(2) : '' })(),
                  _debug_contentKey:      contentKey,
                })
              }
            }
          }
        }
      }
    }

    // ── Resposta ──────────────────────────────────────────────────────────────

    const _debugSalesUntil = (() => { const d = new Date(until); d.setDate(d.getDate() + ATTRIBUTION_WINDOW_DAYS); return d.toISOString().split('T')[0] })()

    const jsonPayload = {
      gerado_em:      new Date().toISOString(),
      conta:          account,
      etapas:         selectedViews,
      periodo:        { since, until },
      nivel:          level,
      time_increment: timeIncrement ?? 'aggregated',
      total_linhas:   rows.length,
      dados:          rows,
      _debug_sales: {
        report_since:         since,
        report_until:         until,
        sales_until:          _debugSalesUntil,
        vendas_map_size:      Object.keys(utmCounts.vendasContent).length,
        vendas_last_map_size: Object.keys(utmCounts.vendasLastContent).length,
        sample_key:           Object.keys(utmCounts.vendasContent)[0] ?? 'VAZIO',
      },
    }

    // Salva no cache (fire-and-forget, não bloqueia a resposta)
    cacheSet(cacheKey, cacheParams, jsonPayload, closedPeriod).catch(() => {})

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="relatorio_${since}_${until}.json"`)
      res.setHeader('X-Cache', 'MISS')
      return res.json(jsonPayload)
    }

    // CSV
    type CsvField = Exclude<keyof ReportRow, 'variacao_periodo_anterior'>
    const headers: CsvField[] = [
      'periodo_inicio', 'periodo_fim', 'data', 'semana',
      'conta', 'etapa', 'etapa_label',
      'campanha', 'conjunto', 'anuncio',
      'orcamento_diario', 'orcamento_total', 'investido',
      'resultados', 'cpr', 'taxa_conversao',
      'impressoes', 'cliques', 'alcance', 'frequencia', 'cpm', 'ctr',
      'cpc',
      'views_3s', 'views_25pct', 'views_50pct', 'views_75pct', 'views_100pct', 'video_avg_time_watched',
      'hook_rate', 'hold_rate', 'thruplay_rate',
      'quality_ranking', 'engagement_rate_ranking', 'conversion_rate_ranking', 'status_entrega', 'dias_desde_criacao',
      'receita_reais', 'roas_real', 'ticket_medio_real', 'lag_dias_conversao_medio',
      'leads_reais', 'cpl_real', 'vendas_reais', 'cpv_real', 'vendas_totais_periodo', 'produto',
      'vendas_any', 'cpv_any', 'vendas_last', 'cpv_last',
    ]
    const csvLines = [
      headers.join(','),
      ...rows.map(r => headers.map(h => csvEscape(r[h] as string)).join(',')),
    ]

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="relatorio_${since}_${until}.csv"`)
    res.setHeader('X-Cache', 'MISS')
    return res.send('﻿' + csvLines.join('\r\n'))

  } catch (err: any) {
    console.error('report error:', err)

    // Rate limit Meta (code 17) — tenta servir cache stale se existir
    if (err instanceof MetaRateLimitError) {
      const staled = await cacheGet(cacheKey).catch(() => null)
      if (staled?.data) {
        res.setHeader('X-Stale-Cache', 'true')
        res.setHeader('X-Retry-After', String(err.retryAfter))
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        return res.status(200).json(staled.data)
      }
      res.setHeader('Retry-After', String(err.retryAfter))
      return res.status(429).json({ error: 'Meta API rate limit atingido. Tente novamente em 10 min.', retry_after: err.retryAfter })
    }

    return res.status(500).json({ error: err.message ?? 'Erro interno' })
  }
}
