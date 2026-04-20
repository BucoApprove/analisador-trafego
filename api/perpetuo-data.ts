import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authUser } from './_supabase-auth.js'

const META_BASE = 'https://graph.facebook.com/v19.0'

const ACCOUNT_IDS: Record<string, string> = {
  conta1: 'act_1082683452063319',
  conta2: 'act_565958430809772',
}

// Keywords para identificar qual campanha pertence a qual etapa/produto
interface NameFilter { include: string[]; exclude?: string[] }

const NAME_FILTERS: Record<string, NameFilter> = {
  etapa1:             { include: ['impulsi', 'boost', 'seguidor'] },
  etapa2:             { include: ['captura', 'aula'], exclude: ['ba25', 'ba 25'] },
  etapa3:             { include: ['relacionamento'], exclude: ['ba25', 'ba 25'] },
  etapa4:             { include: ['convers'], exclude: ['ba25', 'ba 25'] },
  etapa5:             { include: ['remarketing', 'retarget'], exclude: ['ba25', 'ba 25'] },
  anatomia:           { include: ['anatomia'] },
  patologia:          { include: ['patologia'] },
  'lowticket-brasil': { include: ['low ticket brasil', 'lt brasil'] },
  'lowticket-latam':  { include: ['low ticket latam', 'lt latam'] },
}

const VALID_VIEWS = new Set(Object.keys(NAME_FILTERS))

// Deriva os action_types que o Meta usa como "Resultado" para um adset,
// com base no promoted_object do adset (onde custom_conversion_id é definido)
// e no objective da campanha como fallback.
function getResultTypes(adset: {
  optimization_goal?: string
  promoted_object?: { custom_conversion_id?: string; custom_event_type?: string }
}, campaignObjective?: string): string[] {
  const po = adset.promoted_object
  if (po?.custom_conversion_id) {
    return [`offsite_conversion.custom.${po.custom_conversion_id}`]
  }
  const event = po?.custom_event_type ?? ''
  if (event === 'LEAD')                  return ['lead', 'onsite_conversion.lead_grouped']
  if (event === 'PURCHASE')              return ['purchase', 'offsite_conversion.fb_pixel_purchase']
  if (event === 'COMPLETE_REGISTRATION') return ['complete_registration']
  const goal = adset.optimization_goal ?? ''
  if (['LEAD_GENERATION', 'LEAD'].includes(goal))    return ['lead', 'onsite_conversion.lead_grouped']
  if (['OFFSITE_CONVERSIONS', 'VALUE'].includes(goal)) return ['purchase', 'offsite_conversion.fb_pixel_purchase']
  const obj = campaignObjective ?? ''
  if (['LEAD_GENERATION', 'OUTCOME_LEADS'].includes(obj))  return ['lead', 'onsite_conversion.lead_grouped']
  if (['OUTCOME_SALES', 'CONVERSIONS'].includes(obj))      return ['purchase', 'offsite_conversion.fb_pixel_purchase']
  return ['lead', 'onsite_conversion.lead_grouped']
}

function matchesFilter(campaignName: string, filter: NameFilter): boolean {
  const lower = campaignName.toLowerCase()
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

async function metaGet(url: URL): Promise<Record<string, unknown>> {
  const res = await fetch(url.toString())
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Meta API ${res.status}: ${txt.substring(0, 300)}`)
  }
  return res.json() as Promise<Record<string, unknown>>
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdRow {
  adId: string
  adName: string
  spend: number
  results: number
  costPerResult: number
}

interface AdsetRow {
  adsetId: string
  adsetName: string
  dailyBudget: number | null
  lifetimeBudget: number | null
  spend: number
  results?: number
  costPerResult?: number
  landingPageViews?: number
  conversionRate?: number
  videoViews3s?: number
  videoViews25pct?: number
  ads: AdRow[]
}

interface CampaignRow {
  campaignId: string
  campaignName: string
  adsets: AdsetRow[]
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const _user = await authUser(req, res)
  if (!_user) return

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')

  const accessToken = process.env.META_ACCESS_TOKEN ?? ''
  if (!accessToken) {
    return res.status(503).json({ error: 'META_ACCESS_TOKEN não configurado' })
  }

  const account = typeof req.query.account === 'string' ? req.query.account : ''
  const view    = typeof req.query.view    === 'string' ? req.query.view    : ''

  if (!ACCOUNT_IDS[account]) {
    return res.status(400).json({ error: 'account inválido (conta1 | conta2)' })
  }
  if (!VALID_VIEWS.has(view)) {
    return res.status(400).json({ error: `view inválido. Válidos: ${[...VALID_VIEWS].join(', ')}` })
  }

  const today = new Date().toISOString().split('T')[0]
  const re    = /^\d{4}-\d{2}-\d{2}$/
  const since = typeof req.query.since === 'string' && re.test(req.query.since)
    ? req.query.since
    : new Date(Date.now() - 30 * 86_400_000).toISOString().split('T')[0]
  const until = typeof req.query.until === 'string' && re.test(req.query.until)
    ? req.query.until
    : today

  const acctId    = ACCOUNT_IDS[account]
  const timeRange = JSON.stringify({ since, until })
  const filter    = NAME_FILTERS[view]

  const isVideo = view === 'etapa3'
  const isLead  = view === 'etapa2' || view === 'anatomia' || view === 'patologia'

  const adsetInsightFields = [
    'campaign_id', 'campaign_name', 'adset_id', 'adset_name',
    'spend', 'actions',
    'video_thruplay_watched_actions', 'video_p25_watched_actions',
  ].join(',')

  const adInsightFields = [
    'campaign_id', 'campaign_name', 'adset_id', 'ad_id', 'ad_name', 'spend', 'actions',
  ].join(',')

  try {
    // ── 1. Insights no nível de conjunto de anúncios ──────────────────────────
    const adsetUrl = new URL(`${META_BASE}/${acctId}/insights`)
    adsetUrl.searchParams.set('level',        'adset')
    adsetUrl.searchParams.set('fields',       adsetInsightFields)
    adsetUrl.searchParams.set('time_range',   timeRange)
    adsetUrl.searchParams.set('access_token', accessToken)
    adsetUrl.searchParams.set('limit',        '200')

    // ── 2. Insights no nível de anúncio ──────────────────────────────────────
    const adUrl = new URL(`${META_BASE}/${acctId}/insights`)
    adUrl.searchParams.set('level',        'ad')
    adUrl.searchParams.set('fields',       adInsightFields)
    adUrl.searchParams.set('time_range',   timeRange)
    adUrl.searchParams.set('access_token', accessToken)
    adUrl.searchParams.set('limit',        '500')

    // ── 3. Adsets: orçamentos + promoted_object (onde custom_conversion_id vive) ──
    const budgetUrl = new URL(`${META_BASE}/${acctId}/adsets`)
    budgetUrl.searchParams.set('fields',        'id,daily_budget,lifetime_budget,optimization_goal,promoted_object,campaign_id')
    budgetUrl.searchParams.set('access_token',  accessToken)
    budgetUrl.searchParams.set('limit',         '500')

    // ── 4. Campanhas: objective como fallback ─────────────────────────────────
    const campaignUrl = new URL(`${META_BASE}/${acctId}/campaigns`)
    campaignUrl.searchParams.set('fields',           'id,objective')
    campaignUrl.searchParams.set('effective_status', JSON.stringify(['ACTIVE', 'PAUSED', 'ARCHIVED']))
    campaignUrl.searchParams.set('access_token',     accessToken)
    campaignUrl.searchParams.set('limit',            '500')

    const [adsetInsights, adInsights, adsetsRaw, campaignsRaw] = await Promise.all([
      metaGet(adsetUrl),
      metaGet(adUrl),
      metaGet(budgetUrl),
      metaGet(campaignUrl),
    ])

    // Mapa campaignId → objective (fallback)
    const campaignObjective = new Map<string, string>()
    for (const c of (campaignsRaw.data as any[]) ?? []) {
      campaignObjective.set(c.id as string, c.objective ?? '')
    }

    // Mapa adsetId → action_types corretos para "Resultado"
    const adsetResultTypes = new Map<string, string[]>()

    // Mapa de orçamentos + resultTypes por adset
    type Budget = { daily: number | null; lifetime: number | null }
    const budgetMap = new Map<string, Budget>()
    for (const s of (adsetsRaw.data as any[]) ?? []) {
      budgetMap.set(s.id, {
        daily:    s.daily_budget    ? Number(s.daily_budget)    / 100 : null,
        lifetime: s.lifetime_budget ? Number(s.lifetime_budget) / 100 : null,
      })
      const obj = campaignObjective.get(s.campaign_id as string)
      adsetResultTypes.set(s.id as string, getResultTypes(s, obj))
    }

    // Insights de anúncios agrupados por adsetId
    const adsByAdset = new Map<string, any[]>()
    for (const ad of (adInsights.data as any[]) ?? []) {
      if (!matchesFilter(ad.campaign_name as string, filter)) continue
      const list = adsByAdset.get(ad.adset_id as string) ?? []
      list.push(ad)
      adsByAdset.set(ad.adset_id as string, list)
    }

    // Monta resposta agrupada por campanha
    const campaignMap = new Map<string, CampaignRow>()

    for (const row of (adsetInsights.data as any[]) ?? []) {
      if (!matchesFilter(row.campaign_name as string, filter)) continue

      const spend  = Number(row.spend ?? 0)
      const budget = budgetMap.get(row.adset_id as string) ?? { daily: null, lifetime: null }

      const adsetRow: AdsetRow = {
        adsetId:        row.adset_id,
        adsetName:      row.adset_name,
        dailyBudget:    budget.daily,
        lifetimeBudget: budget.lifetime,
        spend,
        ads: (adsByAdset.get(row.adset_id as string) ?? []).map((ad: any): AdRow => {
          const adSpend      = Number(ad.spend ?? 0)
          const adResTypes   = adsetResultTypes.get(ad.adset_id as string) ?? ['lead']
          const adResults    = isVideo ? 0 : actionVal(ad.actions, ...adResTypes)
          return {
            adId:          ad.ad_id,
            adName:        ad.ad_name,
            spend:         adSpend,
            results:       adResults,
            costPerResult: adResults > 0 ? adSpend / adResults : 0,
          }
        }),
      }

      if (isVideo) {
        adsetRow.videoViews3s    = Number(row.video_thruplay_watched_actions?.[0]?.value ?? 0)
        adsetRow.videoViews25pct = Number(row.video_p25_watched_actions?.[0]?.value ?? 0)
      } else {
        const rowResTypes      = adsetResultTypes.get(row.adset_id as string) ?? ['lead']
        const results          = actionVal(row.actions, ...rowResTypes)
        const landingPageViews = actionVal(row.actions, 'landing_page_view')
        adsetRow.results       = results
        adsetRow.costPerResult = results > 0 ? spend / results : 0
        if (isLead) {
          adsetRow.landingPageViews = landingPageViews
          adsetRow.conversionRate   = landingPageViews > 0 ? (results / landingPageViews) * 100 : 0
        }
      }

      const cid = row.campaign_id as string
      if (!campaignMap.has(cid)) {
        campaignMap.set(cid, { campaignId: cid, campaignName: row.campaign_name, adsets: [] })
      }
      campaignMap.get(cid)!.adsets.push(adsetRow)
    }

    // Modo debug: retorna todos os action_types distintos para identificar conversões customizadas
    if (req.query.debug === 'true') {
      const actionTypeSummary: Record<string, number> = {}
      for (const row of (adsetInsights.data as any[]) ?? []) {
        if (!matchesFilter(row.campaign_name as string, filter)) continue
        for (const action of (row.actions ?? []) as { action_type: string; value: string }[]) {
          actionTypeSummary[action.action_type] = (actionTypeSummary[action.action_type] ?? 0) + Number(action.value)
        }
      }
      // Mostra promoted_object e resultTypes por adset para diagnóstico
      const adsetDebug: Record<string, unknown> = {}
      for (const s of (adsetsRaw.data as any[]) ?? []) {
        const adsetInsightRow = (adsetInsights.data as any[])?.find((r: any) => r.adset_id === s.id)
        if (!adsetInsightRow) continue
        if (!matchesFilter(adsetInsightRow.campaign_name as string, filter)) continue
        adsetDebug[s.id] = {
          campaign:          adsetInsightRow.campaign_name,
          optimization_goal: s.optimization_goal,
          promoted_object:   s.promoted_object,
          resultTypes:       adsetResultTypes.get(s.id as string),
        }
      }
      return res.json({ debug: true, actionTypes: actionTypeSummary, adsets: adsetDebug, dateRange: { since, until } })
    }

    return res.json({
      view,
      campaigns: [...campaignMap.values()],
      dateRange:  { since, until },
    })
  } catch (err: any) {
    console.error('perpetuo-data error:', err)
    return res.status(500).json({ error: err.message ?? 'Erro interno' })
  }
}
