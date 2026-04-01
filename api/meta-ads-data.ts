import type { VercelRequest, VercelResponse } from '@vercel/node'

const META_BASE = 'https://graph.facebook.com/v19.0'

function auth(req: VercelRequest, res: VercelResponse): boolean {
  const token = process.env.DASHBOARD_TOKEN
  const header = req.headers.authorization ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!provided || (provided !== token && provided !== process.env.DASHBOARD_TOKEN_ADMIN)) {
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
  reach?: string
  frequency?: string
  actions?: { action_type: string; value: string }[]
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
  const adAccount = process.env.META_AD_ACCOUNT_ID ?? ''
  const ticketMedio = Number(process.env.TICKET_MEDIO ?? '0')

  if (!accessToken || !adAccount) {
    res.status(503).json({ error: 'META_ACCESS_TOKEN ou META_AD_ACCOUNT_ID não configurado' })
    return
  }

  // Período: ?since=YYYY-MM-DD&until=YYYY-MM-DD  OU  ?days=N (padrão 30)
  const today = new Date().toISOString().split('T')[0]
  let since: string
  let until: string
  if (typeof req.query.since === 'string' && typeof req.query.until === 'string') {
    since = req.query.since.match(/^\d{4}-\d{2}-\d{2}$/) ? req.query.since : today
    until = req.query.until.match(/^\d{4}-\d{2}-\d{2}$/) ? req.query.until : today
  } else {
    const days = Math.min(Math.max(parseInt(typeof req.query.days === 'string' ? req.query.days : '30') || 30, 1), 90)
    since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    until = today
  }

  const insightFields = [
    'campaign_id', 'campaign_name', 'spend', 'clicks', 'impressions',
    'ctr', 'cpc', 'reach', 'frequency', 'actions',
  ].join(',')

  const campaignFields = `id,name,status,objective,insights.time_range({"since":"${since}","until":"${until}"}){${insightFields}}`

  try {
    const url = new URL(`${META_BASE}/${adAccount}/campaigns`)
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
      const reach = Number(insight.reach ?? 0)
      const leads = actionValue(insight.actions, 'lead') + actionValue(insight.actions, 'onsite_conversion.lead_grouped')
      const purchases = actionValue(insight.actions, 'purchase') + actionValue(insight.actions, 'offsite_conversion.fb_pixel_purchase')

      g.spend += spend
      g.clicks += clicks
      g.impressions += impressions
      g.reach += reach
      g.leads += leads
      g.purchases += purchases
      g.revenue += purchases * ticketMedio

      totalSpend += spend
      totalLeads += leads
      totalPurchases += purchases

      g.campaigns.push({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        spend, leads, purchases, clicks, impressions, ctr, cpc, reach,
      })
    }

    // Calcula métricas derivadas por grupo
    for (const g of Object.values(groups)) {
      g.cpl = g.leads > 0 ? g.spend / g.leads : 0
      g.cpa = g.purchases > 0 ? g.spend / g.purchases : 0
      g.roas = g.spend > 0 ? g.revenue / g.spend : 0
      g.ctr = g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0
      g.cpc = g.clicks > 0 ? g.spend / g.clicks : 0
      g.frequency = g.reach > 0 ? g.impressions / g.reach : 0
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
