/**
 * GET /api/report
 *
 * Gera um relatório plano (CSV ou JSON) de campanhas Meta Ads para análise por IA.
 *
 * Query params:
 *   token    — DASHBOARD_TOKEN (obrigatório, passado direto na URL)
 *   account  — conta1 | conta2
 *   views    — etapas separadas por vírgula, ex: etapa2,etapa4,etapa5
 *              ou "all" para todas as views da conta selecionada
 *   since    — YYYY-MM-DD (padrão: 1º do mês atual)
 *   until    — YYYY-MM-DD (padrão: hoje)
 *   format   — csv | json  (padrão: csv)
 *   level    — campaign | adset | ad  (padrão: adset)
 *
 * Exemplo de URL para IA:
 *   https://analisador-trafego.vercel.app/api/report?token=SEU_TOKEN&account=conta1&views=etapa2,etapa4&since=2026-04-01&until=2026-04-20&format=csv
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'

const META_BASE = 'https://graph.facebook.com/v19.0'

const ACCOUNT_IDS: Record<string, string> = {
  conta1: 'act_1082683452063319',
  conta2: 'act_565958430809772',
}

interface NameFilter { include: string[]; exclude?: string[] }

const NAME_FILTERS: Record<string, NameFilter> = {
  etapa1:             { include: ['impulsi', 'boost', 'seguidor', '[instagram] - post'] },
  etapa2:             { include: ['captura', 'aula'] },
  etapa3:             { include: ['relacionamento', 'engajamento'], exclude: ['ba25', 'ba 25'] },
  etapa4:             { include: ['convers', 'venda'], exclude: ['ba25', 'ba 25'] },
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

function matchesFilter(name: string, filter: NameFilter): boolean {
  const lower = name.toLowerCase()
  if (filter.exclude?.some(kw => lower.includes(kw))) return false
  return filter.include.some(kw => lower.includes(kw))
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

async function metaGetAll(url: URL): Promise<any[]> {
  const allData: any[] = []
  let nextUrl: string | null = url.toString()
  while (nextUrl) {
    const res = await fetch(nextUrl)
    if (!res.ok) {
      const txt = await res.text()
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
  promoted_object?: { custom_conversion_id?: string; custom_event_type?: string; custom_event_str?: string }
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

// ─── Tipos de linha do relatório ──────────────────────────────────────────────

interface ReportRow {
  periodo_inicio:    string
  periodo_fim:       string
  conta:             string
  etapa:             string
  etapa_label:       string
  campanha:          string
  conjunto:          string
  anuncio:           string
  orcamento_diario:  string
  orcamento_total:   string
  investido:         string
  resultados:        string
  cpr:               string
  taxa_conversao:    string
  views_3s:          string
  views_25pct:       string
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Autenticação via DASHBOARD_TOKEN na URL (para facilitar acesso por IA)
  const providedToken = typeof req.query.token === 'string' ? req.query.token : ''
  const validToken = process.env.DASHBOARD_TOKEN ?? ''
  const validAdmin = process.env.DASHBOARD_TOKEN_ADMIN ?? ''
  if (!providedToken || (providedToken !== validToken && providedToken !== validAdmin)) {
    return res.status(401).json({ error: 'Token inválido. Passe ?token=SEU_TOKEN' })
  }

  const accessToken = process.env.META_ACCESS_TOKEN ?? ''
  if (!accessToken) return res.status(503).json({ error: 'META_ACCESS_TOKEN não configurado' })

  // Parâmetros
  const account = typeof req.query.account === 'string' ? req.query.account : 'conta1'
  if (!ACCOUNT_IDS[account]) return res.status(400).json({ error: 'account inválido (conta1 | conta2)' })

  const accountViews = account === 'conta1' ? CONTA1_VIEWS : CONTA2_VIEWS
  const viewsParam   = typeof req.query.views === 'string' ? req.query.views : 'all'
  const selectedViews = viewsParam === 'all'
    ? accountViews
    : viewsParam.split(',').map(v => v.trim()).filter(v => NAME_FILTERS[v] && accountViews.includes(v))

  if (selectedViews.length === 0) {
    return res.status(400).json({ error: `Nenhuma view válida. Opções: ${accountViews.join(', ')}` })
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

  const acctId    = ACCOUNT_IDS[account]
  const timeRange = JSON.stringify({ since, until })

  try {
    // Busca dados em paralelo
    const adsetInsightUrl = new URL(`${META_BASE}/${acctId}/insights`)
    adsetInsightUrl.searchParams.set('level',        'adset')
    adsetInsightUrl.searchParams.set('fields',       'campaign_id,campaign_name,adset_id,adset_name,spend,actions,video_thruplay_watched_actions,video_p25_watched_actions')
    adsetInsightUrl.searchParams.set('time_range',   timeRange)
    adsetInsightUrl.searchParams.set('access_token', accessToken)
    adsetInsightUrl.searchParams.set('limit',        '200')

    const adInsightUrl = new URL(`${META_BASE}/${acctId}/insights`)
    adInsightUrl.searchParams.set('level',        'ad')
    adInsightUrl.searchParams.set('fields',       'campaign_name,adset_id,adset_name,ad_id,ad_name,spend,actions')
    adInsightUrl.searchParams.set('time_range',   timeRange)
    adInsightUrl.searchParams.set('access_token', accessToken)
    adInsightUrl.searchParams.set('limit',        '500')

    const adsetsUrl = new URL(`${META_BASE}/${acctId}/adsets`)
    adsetsUrl.searchParams.set('fields',       'id,daily_budget,lifetime_budget,optimization_goal,promoted_object,campaign_id')
    adsetsUrl.searchParams.set('access_token', accessToken)
    adsetsUrl.searchParams.set('limit',        '500')

    const campaignUrl = new URL(`${META_BASE}/${acctId}/campaigns`)
    campaignUrl.searchParams.set('fields',       'id,objective')
    campaignUrl.searchParams.set('access_token', accessToken)
    campaignUrl.searchParams.set('limit',        '500')

    const [adsetInsights, adInsights, adsetsData, campaignsData] = await Promise.all([
      metaGetAll(adsetInsightUrl),
      metaGetAll(adInsightUrl),
      metaGetAll(adsetsUrl),
      metaGetAll(campaignUrl),
    ])

    // Mapas auxiliares
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

    // Agrupa anúncios por adsetId
    const adsByAdset = new Map<string, any[]>()
    for (const ad of adInsights) {
      const list = adsByAdset.get(ad.adset_id) ?? []
      list.push(ad)
      adsByAdset.set(ad.adset_id, list)
    }

    // Constrói linhas do relatório
    const rows: ReportRow[] = []

    for (const viewId of selectedViews) {
      const filter     = NAME_FILTERS[viewId]
      const viewLabel  = VIEW_LABELS[viewId] ?? viewId
      const isVideo    = viewId === 'etapa3'

      // Agrupa por campanha → adset
      const campMap = new Map<string, { name: string; adsets: any[] }>()
      for (const row of adsetInsights) {
        if (!matchesFilter(row.campaign_name, filter)) continue
        if (!campMap.has(row.campaign_id)) campMap.set(row.campaign_id, { name: row.campaign_name, adsets: [] })
        campMap.get(row.campaign_id)!.adsets.push(row)
      }

      for (const [, camp] of campMap) {
        // Linha de campanha (totais)
        if (level === 'campaign' || level === 'adset' || level === 'ad') {
          const campSpend   = camp.adsets.reduce((s, r) => s + Number(r.spend ?? 0), 0)
          const campResults = camp.adsets.reduce((s, r) => {
            const rt = adsetMeta.get(r.adset_id)?.resultTypes ?? ['lead']
            return s + actionVal(r.actions, ...rt)
          }, 0)
          rows.push({
            periodo_inicio:  since,
            periodo_fim:     until,
            conta:           account,
            etapa:           viewId,
            etapa_label:     viewLabel,
            campanha:        camp.name,
            conjunto:        '',
            anuncio:         '',
            orcamento_diario:  '',
            orcamento_total:   '',
            investido:       campSpend.toFixed(2),
            resultados:      campResults.toString(),
            cpr:             campResults > 0 ? (campSpend / campResults).toFixed(2) : '',
            taxa_conversao:  '',
            views_3s:        isVideo ? camp.adsets.reduce((s, r) => s + Number(r.video_thruplay_watched_actions?.[0]?.value ?? 0), 0).toString() : '',
            views_25pct:     isVideo ? camp.adsets.reduce((s, r) => s + Number(r.video_p25_watched_actions?.[0]?.value ?? 0), 0).toString() : '',
          })
        }

        if (level === 'adset' || level === 'ad') {
          for (const adsetRow of camp.adsets) {
            const meta    = adsetMeta.get(adsetRow.adset_id)
            const spend   = Number(adsetRow.spend ?? 0)
            const rt      = meta?.resultTypes ?? ['lead']
            const results = isVideo ? 0 : actionVal(adsetRow.actions, ...rt)
            const lpv     = actionVal(adsetRow.actions, 'landing_page_view')

            rows.push({
              periodo_inicio:  since,
              periodo_fim:     until,
              conta:           account,
              etapa:           viewId,
              etapa_label:     viewLabel,
              campanha:        camp.name,
              conjunto:        adsetRow.adset_name,
              anuncio:         '',
              orcamento_diario:  meta?.daily    != null ? meta.daily.toFixed(2)    : '',
              orcamento_total:   meta?.lifetime != null ? meta.lifetime.toFixed(2) : '',
              investido:       spend.toFixed(2),
              resultados:      results.toString(),
              cpr:             results > 0 ? (spend / results).toFixed(2) : '',
              taxa_conversao:  lpv > 0 ? ((results / lpv) * 100).toFixed(1) : '',
              views_3s:        isVideo ? String(Number(adsetRow.video_thruplay_watched_actions?.[0]?.value ?? 0)) : '',
              views_25pct:     isVideo ? String(Number(adsetRow.video_p25_watched_actions?.[0]?.value ?? 0)) : '',
            })

            if (level === 'ad') {
              for (const ad of adsByAdset.get(adsetRow.adset_id) ?? []) {
                const adSpend   = Number(ad.spend ?? 0)
                const adResults = actionVal(ad.actions, ...rt)
                rows.push({
                  periodo_inicio:  since,
                  periodo_fim:     until,
                  conta:           account,
                  etapa:           viewId,
                  etapa_label:     viewLabel,
                  campanha:        camp.name,
                  conjunto:        adsetRow.adset_name,
                  anuncio:         ad.ad_name,
                  orcamento_diario:  '',
                  orcamento_total:   '',
                  investido:       adSpend.toFixed(2),
                  resultados:      adResults.toString(),
                  cpr:             adResults > 0 ? (adSpend / adResults).toFixed(2) : '',
                  taxa_conversao:  '',
                  views_3s:        '',
                  views_25pct:     '',
                })
              }
            }
          }
        }
      }
    }

    // ── Resposta ──────────────────────────────────────────────────────────────

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="relatorio_${since}_${until}.json"`)
      return res.json({
        gerado_em:  new Date().toISOString(),
        conta:      account,
        etapas:     selectedViews,
        periodo:    { since, until },
        nivel:      level,
        total_linhas: rows.length,
        dados: rows,
      })
    }

    // CSV
    const headers: (keyof ReportRow)[] = [
      'periodo_inicio', 'periodo_fim', 'conta', 'etapa', 'etapa_label',
      'campanha', 'conjunto', 'anuncio',
      'orcamento_diario', 'orcamento_total', 'investido',
      'resultados', 'cpr', 'taxa_conversao', 'views_3s', 'views_25pct',
    ]
    const csvLines = [
      headers.join(','),
      ...rows.map(r => headers.map(h => csvEscape(r[h])).join(',')),
    ]

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="relatorio_${since}_${until}.csv"`)
    return res.send('\uFEFF' + csvLines.join('\r\n')) // BOM para Excel abrir UTF-8 corretamente

  } catch (err: any) {
    console.error('report error:', err)
    return res.status(500).json({ error: err.message ?? 'Erro interno' })
  }
}
