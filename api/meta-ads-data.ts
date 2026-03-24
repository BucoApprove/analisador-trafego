import type { VercelRequest, VercelResponse } from '@vercel/node'

const META_BASE = 'https://graph.facebook.com/v19.0'
const AD_ACCOUNT = 'act_1379639915667456'
const TICKET_MEDIO = 1197

function auth(req: VercelRequest, res: VercelResponse): boolean {
  const token = process.env.DASHBOARD_TOKEN
  const header = req.headers.authorization ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token || provided !== token) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

type CampaignObjective = string

function classifyCampaign(name: string, objective: CampaignObjective): 'captacao' | 'vendaDireta' | 'boosts' {
  const lower = name.toLowerCase()
  if (objective === 'OUTCOME_ENGAGEMENT' || lower.includes('boost') || lower.includes('impulsionad')) {
    return 'boosts'
  }
  if (lower.includes('venda') || lower.includes('checkout') || lower.includes('oferta') || objective === 'OUTCOME_SALES') {
    return 'vendaDireta'
  }
  return 'captacao'
}

interface MetaInsight {
  campaign_id: string
  campaign_name: string
  spend: string
  clicks: string
  impressions: string
  ctr: string
  cpc: string
  actions?: { action_type: string; value: string }[]
  video_avg_percent_watched_actions?: { action_type: string; value: string }[]
}

interface MetaCampaignRaw {
  id: string
  name: string
  status: string
  objective: string
  insights?: { data: MetaInsight[] }
}

function emptyGroup() {
  return {
    spend: 0, leads: 0, cpl: 0, clicks: 0, impressions: 0,
    ctr: 0, cpc: 0, reach: 0, frequency: 0, cpa: 0, roas: 0,
    purchases: 0, revenue: 0, videoRetention: 0, followers: 0,
    campaigns: [] as {
      id: string; name: string; status: string
      spend: number; leads: number; clicks: number
      impressions: number; ctr: number; cpc: number
    }[],
  }
}

function actionValue(actions: MetaInsight['actions'], type: string): number {
  return Number(actions?.find(a => a.action_type === type)?.value ?? 0)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!auth(req, res)) return

  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120')

  const accessToken = process.env.META_ACCESS_TOKEN ?? ''

  // Período: últimos 30 dias
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const until = new Date().toISOString().split('T')[0]

  const insightFields = [
    'campaign_id', 'campaign_name', 'spend', 'clicks', 'impressions',
    'ctr', 'cpc', 'actions', 'video_avg_percent_watched_actions',
  ].join(',')

  const campaignFields = `id,name,status,objective,insights.time_range({"since":"${since}","until":"${until}"}){${insightFields}}`

  try {
    const url = new URL(`${META_BASE}/${AD_ACCOUNT}/campaigns`)
    url.searchParams.set('fields', campaignFields)
    url.searchParams.set('access_token', accessToken)
    url.searchParams.set('limit', '100')

    const metaRes = await fetch(url.toString())
    if (!metaRes.ok) {
      const errBody = await metaRes.text()
      console.error('Meta API error:', errBody)
      res.status(502).json({ error: 'Erro ao buscar dados do Meta' })
      return
    }

    const metaData = await metaRes.json() as { data: MetaCampaignRaw[] }
    const campaigns = metaData.data ?? []

    const groups = {
      captacao: emptyGroup(),
      vendaDireta: emptyGroup(),
      boosts: emptyGroup(),
    }

    let totalSpend = 0
    let totalLeads = 0
    let totalPurchases = 0

    for (const campaign of campaigns) {
      const insight = campaign.insights?.data?.[0]
      if (!insight) continue

      const groupKey = classifyCampaign(campaign.name, campaign.objective)
      const g = groups[groupKey]

      const spend = Number(insight.spend ?? 0)
      const clicks = Number(insight.clicks ?? 0)
      const impressions = Number(insight.impressions ?? 0)
      const ctr = Number(insight.ctr ?? 0)
      const cpc = Number(insight.cpc ?? 0)
      const leads = actionValue(insight.actions, 'lead') + actionValue(insight.actions, 'onsite_conversion.lead_grouped')
      const purchases = actionValue(insight.actions, 'purchase') + actionValue(insight.actions, 'offsite_conversion.fb_pixel_purchase')

      g.spend += spend
      g.clicks += clicks
      g.impressions += impressions
      g.leads += leads
      g.purchases += purchases
      g.revenue += purchases * TICKET_MEDIO

      totalSpend += spend
      totalLeads += leads
      totalPurchases += purchases

      g.campaigns.push({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        spend, leads, clicks, impressions, ctr, cpc,
      })
    }

    // Calcula métricas derivadas por grupo
    for (const g of Object.values(groups)) {
      g.cpl = g.leads > 0 ? g.spend / g.leads : 0
      g.cpa = g.purchases > 0 ? g.spend / g.purchases : 0
      g.roas = g.spend > 0 ? g.revenue / g.spend : 0
      g.ctr = g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0
      g.cpc = g.clicks > 0 ? g.spend / g.clicks : 0
    }

    res.json({
      captacao: groups.captacao,
      vendaDireta: groups.vendaDireta,
      boosts: groups.boosts,
      totalSpend,
      totalLeads,
      totalPurchases,
      dateRange: { start: since, end: until },
    })
  } catch (err) {
    console.error('meta-ads-data error:', err)
    res.status(500).json({ error: 'Erro interno' })
  }
}
