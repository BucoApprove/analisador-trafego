/**
 * GET /api/report-breakdown
 *
 * Relatório com breakdown por placement, age_gender, device ou region.
 * Retorna dados agregados no nível campanha.
 *
 * Query params:
 *   token     — DASHBOARD_TOKEN (obrigatório)
 *   account   — conta1 | conta2
 *   views     — etapas separadas por vírgula (ex: etapa2)
 *   since     — YYYY-MM-DD
 *   until     — YYYY-MM-DD
 *   level     — campaign (único suportado nesta v1)
 *   breakdown — placement | age_gender | device | region
 *   format    — json | csv (padrão: json)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

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

const CONTA1_VIEWS = ['etapa1', 'etapa2', 'etapa3', 'etapa4', 'etapa5']
const CONTA2_VIEWS = ['anatomia', 'patologia', 'lowticket-brasil', 'lowticket-latam']

const VALID_BREAKDOWNS = ['placement', 'age_gender', 'device', 'region'] as const
type Breakdown = typeof VALID_BREAKDOWNS[number]

function normKw(s: string): string { return s.toLowerCase().replace(/[-_]/g, ' ') }

function matchesFilter(name: string, filter: NameFilter): boolean {
  const lower = normKw(name)
  if (filter.exclude?.some(kw => lower.includes(normKw(kw)))) return false
  return filter.include.some(kw => lower.includes(normKw(kw)))
}

function actionVal(actions: { action_type: string; value: string }[] | undefined, ...types: string[]): number {
  if (!actions) return 0
  return types.reduce((sum, t) => sum + Number(actions.find(a => a.action_type === t)?.value ?? 0), 0)
}

async function metaGetAll(url: URL): Promise<any[]> {
  const all: any[] = []
  let next: string | null = url.toString()
  while (next) {
    const res = await fetch(next)
    if (!res.ok) throw new Error(`Meta API ${res.status}: ${(await res.text()).substring(0, 300)}`)
    const json = await res.json() as Record<string, unknown>
    all.push(...((json.data as any[]) ?? []))
    next = (json.paging as any)?.next ?? null
  }
  return all
}

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_KEY ?? '',
    { auth: { persistSession: false } },
  )
}

async function loadCustomFilters(account: string, views: string[]): Promise<Record<string, NameFilter>> {
  try {
    const sb = getSupabase()
    const { data } = await sb.from('etapa_filters').select('view, include, exclude').eq('account', account).in('view', views)
    if (!data) return {}
    const result: Record<string, NameFilter> = {}
    for (const row of data) result[row.view] = { include: row.include ?? [], exclude: row.exclude ?? [] }
    return result
  } catch { return {} }
}

// Mapeia o campo de breakdown da Meta para o valor legível em breakdown_valor
function breakdownValor(row: any, breakdown: Breakdown): string {
  switch (breakdown) {
    case 'placement':
      return [row.publisher_platform, row.platform_position].filter(Boolean).join('_') || (row.impression_device ?? '')
    case 'age_gender':
      return `${row.age ?? 'unknown'}:${(row.gender as string ?? 'U').charAt(0).toUpperCase()}`
    case 'device':
      return (row.impression_device as string ?? 'unknown').toLowerCase()
    case 'region':
      return (row.region as string) ?? ''
  }
}

// Campos de breakdown que a Meta espera por tipo
const BREAKDOWN_PARAMS: Record<Breakdown, string> = {
  placement:  'publisher_platform,platform_position,impression_device',
  age_gender: 'age,gender',
  device:     'impression_device',
  region:     'region',
}

function csvEscape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) return `"${val.replace(/"/g, '""')}"`
  return val
}

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

  const breakdown = typeof req.query.breakdown === 'string' ? req.query.breakdown as Breakdown : 'placement'
  if (!VALID_BREAKDOWNS.includes(breakdown)) {
    return res.status(400).json({ error: `breakdown inválido. Opções: ${VALID_BREAKDOWNS.join(', ')}` })
  }

  const accountViews  = account === 'conta1' ? CONTA1_VIEWS : CONTA2_VIEWS
  const viewsParam    = typeof req.query.views === 'string' ? req.query.views : 'all'
  const selectedViews = viewsParam === 'all'
    ? accountViews
    : viewsParam.split(',').map(v => v.trim()).filter(v => NAME_FILTERS[v] && accountViews.includes(v))

  if (selectedViews.length === 0) {
    return res.status(400).json({ error: `Nenhuma view válida. Opções: ${accountViews.join(', ')}` })
  }

  const customFilters = await loadCustomFilters(account, selectedViews)
  const effectiveFilters: Record<string, NameFilter> = {}
  for (const v of selectedViews) effectiveFilters[v] = customFilters[v] ?? NAME_FILTERS[v]

  const re    = /^\d{4}-\d{2}-\d{2}$/
  const today = new Date().toISOString().split('T')[0]
  const since = typeof req.query.since === 'string' && re.test(req.query.since)
    ? req.query.since : new Date(new Date().setDate(1)).toISOString().split('T')[0]
  const until = typeof req.query.until === 'string' && re.test(req.query.until)
    ? req.query.until : today

  const format = typeof req.query.format === 'string' && req.query.format === 'csv' ? 'csv' : 'json'

  const acctId    = ACCOUNT_IDS[account]
  const timeRange = JSON.stringify({ since, until })

  // Busca resultTypes por adset (para saber qual action contar como resultado)
  const adsetsUrl = new URL(`${META_BASE}/${acctId}/adsets`)
  adsetsUrl.searchParams.set('fields',       'id,optimization_goal,promoted_object,campaign_id')
  adsetsUrl.searchParams.set('access_token', accessToken)
  adsetsUrl.searchParams.set('limit',        '500')

  const campaignUrl = new URL(`${META_BASE}/${acctId}/campaigns`)
  campaignUrl.searchParams.set('fields',       'id,objective')
  campaignUrl.searchParams.set('access_token', accessToken)
  campaignUrl.searchParams.set('limit',        '500')

  const insightUrl = new URL(`${META_BASE}/${acctId}/insights`)
  insightUrl.searchParams.set('level',        'campaign')
  insightUrl.searchParams.set('fields',       'campaign_id,campaign_name,spend,actions,impressions,clicks,cpm,ctr,reach,frequency')
  insightUrl.searchParams.set('breakdowns',   BREAKDOWN_PARAMS[breakdown])
  insightUrl.searchParams.set('time_range',   timeRange)
  insightUrl.searchParams.set('access_token', accessToken)
  insightUrl.searchParams.set('limit',        '500')

  try {
    const [insights, adsetsData, campaignsData] = await Promise.all([
      metaGetAll(insightUrl),
      metaGetAll(adsetsUrl),
      metaGetAll(campaignUrl),
    ])

    // Mapa campaign_id → resultTypes (aproximado pela maioria dos adsets)
    const campaignObjective = new Map<string, string>()
    for (const c of campaignsData) campaignObjective.set(c.id, c.objective ?? '')

    // Mapa adset_id → resultTypes
    function getResultTypes(adset: any, obj: string): string[] {
      const po = adset.promoted_object
      if (po?.custom_conversion_id) return [`offsite_conversion.custom.${po.custom_conversion_id}`]
      const event = po?.custom_event_type ?? ''
      if (event === 'LEAD')     return ['lead', 'onsite_conversion.lead_grouped']
      if (event === 'PURCHASE') return ['purchase', 'offsite_conversion.fb_pixel_purchase']
      const goal = adset.optimization_goal ?? ''
      if (['LEAD_GENERATION', 'LEAD'].includes(goal)) return ['lead', 'onsite_conversion.lead_grouped']
      if (['OUTCOME_SALES', 'CONVERSIONS'].includes(obj)) return ['purchase', 'offsite_conversion.fb_pixel_purchase']
      if (['LEAD_GENERATION', 'OUTCOME_LEADS'].includes(obj)) return ['lead', 'onsite_conversion.lead_grouped']
      return ['lead', 'onsite_conversion.lead_grouped']
    }

    // Mapa campaign_id → resultTypes (usando o primeiro adset da campanha como proxy)
    const campResultTypes = new Map<string, string[]>()
    for (const s of adsetsData) {
      if (!campResultTypes.has(s.campaign_id)) {
        campResultTypes.set(s.campaign_id, getResultTypes(s, campaignObjective.get(s.campaign_id) ?? ''))
      }
    }

    interface BreakdownRow {
      campanha:        string
      breakdown_valor: string
      investido:       string
      resultados:      string
      cpr:             string
      impressoes:      string
      alcance:         string
      frequencia:      string
      cpm:             string
      ctr:             string
    }

    const rows: BreakdownRow[] = []

    for (const row of insights) {
      // Verifica se a campanha pertence a alguma view selecionada
      const matchedView = selectedViews.find(v => matchesFilter(row.campaign_name, effectiveFilters[v]))
      if (!matchedView) continue

      const spend    = Number(row.spend ?? 0)
      const rt       = campResultTypes.get(row.campaign_id) ?? ['lead']
      const results  = actionVal(row.actions, ...rt)
      const imp      = Number(row.impressions ?? 0)
      const clk      = Number(row.clicks ?? 0)
      const alc      = Number(row.reach ?? 0)

      rows.push({
        campanha:        row.campaign_name,
        breakdown_valor: breakdownValor(row, breakdown),
        investido:       spend.toFixed(2),
        resultados:      String(results),
        cpr:             results > 0 ? (spend / results).toFixed(2) : '',
        impressoes:      String(imp),
        alcance:         String(alc),
        frequencia:      imp > 0 && alc > 0 ? (imp / alc).toFixed(2) : '',
        cpm:             row.cpm ? Number(row.cpm).toFixed(2) : (imp > 0 ? ((spend / imp) * 1000).toFixed(2) : ''),
        ctr:             row.ctr ? Number(row.ctr).toFixed(2) : (imp > 0 ? ((clk / imp) * 100).toFixed(2) : ''),
      })
    }

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      return res.json({
        gerado_em:      new Date().toISOString(),
        conta:          account,
        etapas:         selectedViews,
        periodo:        { since, until },
        breakdown_tipo: breakdown,
        total_linhas:   rows.length,
        dados:          rows,
      })
    }

    // CSV
    const headers: (keyof BreakdownRow)[] = [
      'campanha', 'breakdown_valor', 'investido', 'resultados', 'cpr',
      'impressoes', 'alcance', 'frequencia', 'cpm', 'ctr',
    ]
    const csvLines = [
      headers.join(','),
      ...rows.map(r => headers.map(h => csvEscape(r[h])).join(',')),
    ]
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="breakdown_${breakdown}_${since}_${until}.csv"`)
    return res.send('﻿' + csvLines.join('\r\n'))

  } catch (err: any) {
    console.error('report-breakdown error:', err)
    return res.status(500).json({ error: err.message ?? 'Erro interno' })
  }
}
