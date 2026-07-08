/**
 * Árvore Campanha → Conjunto de Anúncios → Anúncio, com gasto e resultado
 * (lead) reportado pela própria Meta, para o drill-down estrutural de um
 * lançamento. Mesmo padrão de filtro AND/OR de api/meta-spend.ts, mas
 * buscando também o nível "adset" (que meta-spend.ts não busca).
 *
 * O "resultado" aqui é o que a Meta reporta via actions (lead pixel/CAPI) —
 * serve como comparação secundária. A fonte principal de leads do negócio
 * é o BigQuery (api/lancamento-leads-by-content.ts), cruzada no frontend.
 *
 * Query params:
 *   spendFilter — keywords AND (ex: "BA25")
 *   orFilter    — keywords OR separadas por vírgula
 *   since, until — datas YYYY-MM-DD
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authUser } from './_supabase-auth.js'

const META_BASE = 'https://graph.facebook.com/v19.0'

interface AdTreeRow {
  adId: string
  adName: string
  spend: number
  metaResults: number
  metaCostPerResult: number
}

interface AdsetTreeRow {
  adsetId: string
  adsetName: string
  adsetStatus: string
  dailyBudget: number | null
  lifetimeBudget: number | null
  spend: number
  metaResults: number
  metaCostPerResult: number
  ads: AdTreeRow[]
}

interface CampaignTreeRow {
  campaignId: string
  campaignName: string
  adsets: AdsetTreeRow[]
}

interface MetaAction { action_type: string; value: string }
interface AdsetInsightRow { campaign_id: string; campaign_name: string; adset_id: string; adset_name: string; spend?: string; actions?: MetaAction[] }
interface AdInsightRow { campaign_id: string; campaign_name: string; adset_id: string; ad_id: string; ad_name: string; spend?: string; actions?: MetaAction[] }
interface AdsetMetaRow { id: string; daily_budget?: string; lifetime_budget?: string; campaign_id?: string; effective_status?: string }

async function metaGetAll<T>(url: URL, maxPages = 10): Promise<T[]> {
  const allData: T[] = []
  let nextUrl: string | null = url.toString()
  let page = 0
  while (nextUrl && page < maxPages) {
    const res = await fetch(nextUrl)
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`Meta API ${res.status}: ${txt.substring(0, 300)}`)
    }
    const json = await res.json() as { data?: T[]; paging?: { next?: string } }
    allData.push(...(json.data ?? []))
    nextUrl = json.paging?.next ?? null
    page++
  }
  return allData
}

function actionVal(actions: MetaAction[] | undefined, ...types: string[]): number {
  if (!actions) return 0
  for (const t of types) {
    const val = Number(actions.find(a => a.action_type === t)?.value ?? 0)
    if (val > 0) return val
  }
  return 0
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const _user = await authUser(req, res); if (!_user) return

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')

  const since = typeof req.query.since === 'string' ? req.query.since : ''
  const until = typeof req.query.until === 'string' ? req.query.until : ''
  if (!since || !until) return res.status(400).json({ error: 'since e until são obrigatórios (YYYY-MM-DD)' })

  const spendKeywords = (typeof req.query.spendFilter === 'string' ? req.query.spendFilter : '')
    .split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
  const orKeywords = (typeof req.query.orFilter === 'string' ? req.query.orFilter : '')
    .split(',').map(k => k.trim().toLowerCase()).filter(Boolean)

  const accessToken = process.env.META_ACCESS_TOKEN ?? ''
  const adAccount = process.env.META_AD_ACCOUNT_ID ?? ''
  if (!accessToken || !adAccount) {
    return res.status(500).json({ error: 'META_ACCESS_TOKEN ou META_AD_ACCOUNT_ID não configurado' })
  }

  const matchesFilter = (name: string) => {
    const lower = name.toLowerCase()
    const matchesAnd = spendKeywords.length > 0 && spendKeywords.every(k => lower.includes(k))
    const matchesOr = orKeywords.length > 0 && orKeywords.some(k => lower.includes(k))
    return matchesAnd || matchesOr
  }

  const timeRange = JSON.stringify({ since, until })

  try {
    const adsetUrl = new URL(`${META_BASE}/${adAccount}/insights`)
    adsetUrl.searchParams.set('level', 'adset')
    adsetUrl.searchParams.set('fields', 'campaign_id,campaign_name,adset_id,adset_name,spend,actions')
    adsetUrl.searchParams.set('time_range', timeRange)
    adsetUrl.searchParams.set('access_token', accessToken)
    adsetUrl.searchParams.set('limit', '200')

    const adUrl = new URL(`${META_BASE}/${adAccount}/insights`)
    adUrl.searchParams.set('level', 'ad')
    adUrl.searchParams.set('fields', 'campaign_id,campaign_name,adset_id,ad_id,ad_name,spend,actions')
    adUrl.searchParams.set('time_range', timeRange)
    adUrl.searchParams.set('access_token', accessToken)
    adUrl.searchParams.set('limit', '500')

    const budgetUrl = new URL(`${META_BASE}/${adAccount}/adsets`)
    budgetUrl.searchParams.set('fields', 'id,daily_budget,lifetime_budget,campaign_id,effective_status')
    budgetUrl.searchParams.set('access_token', accessToken)
    budgetUrl.searchParams.set('limit', '500')

    const [adsetInsights, adInsights, adsetsMeta] = await Promise.all([
      metaGetAll<AdsetInsightRow>(adsetUrl, 5),
      metaGetAll<AdInsightRow>(adUrl, 5),
      metaGetAll<AdsetMetaRow>(budgetUrl),
    ])

    type Budget = { daily: number | null; lifetime: number | null; status: string }
    const budgetMap = new Map<string, Budget>()
    for (const s of adsetsMeta) {
      budgetMap.set(s.id, {
        daily: s.daily_budget ? Number(s.daily_budget) / 100 : null,
        lifetime: s.lifetime_budget ? Number(s.lifetime_budget) / 100 : null,
        status: s.effective_status ?? 'UNKNOWN',
      })
    }

    const adsByAdset = new Map<string, AdInsightRow[]>()
    for (const ad of adInsights) {
      if (!matchesFilter(ad.campaign_name)) continue
      const list = adsByAdset.get(ad.adset_id) ?? []
      list.push(ad)
      adsByAdset.set(ad.adset_id, list)
    }

    const campaignMap = new Map<string, CampaignTreeRow>()

    for (const row of adsetInsights) {
      if (!matchesFilter(row.campaign_name)) continue

      const spend = Number(row.spend ?? 0)
      const budget = budgetMap.get(row.adset_id) ?? { daily: null, lifetime: null, status: 'UNKNOWN' }
      const metaResults = actionVal(row.actions, 'lead', 'onsite_conversion.lead_grouped')

      const adsetRow: AdsetTreeRow = {
        adsetId: row.adset_id,
        adsetName: row.adset_name,
        adsetStatus: budget.status,
        dailyBudget: budget.daily,
        lifetimeBudget: budget.lifetime,
        spend,
        metaResults,
        metaCostPerResult: metaResults > 0 ? spend / metaResults : 0,
        ads: (adsByAdset.get(row.adset_id) ?? []).map((ad): AdTreeRow => {
          const adSpend = Number(ad.spend ?? 0)
          const adResults = actionVal(ad.actions, 'lead', 'onsite_conversion.lead_grouped')
          return {
            adId: ad.ad_id,
            adName: ad.ad_name,
            spend: adSpend,
            metaResults: adResults,
            metaCostPerResult: adResults > 0 ? adSpend / adResults : 0,
          }
        }).sort((a, b) => b.metaResults - a.metaResults),
      }

      const cid = row.campaign_id
      if (!campaignMap.has(cid)) {
        campaignMap.set(cid, { campaignId: cid, campaignName: row.campaign_name, adsets: [] })
      }
      campaignMap.get(cid)!.adsets.push(adsetRow)
    }

    const campaigns = [...campaignMap.values()].sort(
      (a, b) => b.adsets.reduce((s, ad) => s + ad.spend, 0) - a.adsets.reduce((s, ad) => s + ad.spend, 0),
    )

    res.json({ campaigns, dateRange: { since, until } })
  } catch (err) {
    console.error('lancamento-ads-tree error:', err)
    res.status(500).json({ error: 'Erro interno', detail: (err as Error).message })
  }
}
