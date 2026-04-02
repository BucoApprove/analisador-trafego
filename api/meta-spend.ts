/**
 * Endpoint dedicado para buscar gasto Meta Ads.
 * Chamado em paralelo com /api/launch-data pelo frontend.
 *
 * Query params:
 *   spendFilter — keywords AND (ex: "BA25")
 *   orFilter    — keywords OR separadas por vírgula (ex: "instagram,engajamento,lembrete,remarketing")
 *   since, until — datas YYYY-MM-DD
 *   totalLeads  — total de leads únicos para cálculo do CPL
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authUser } from './_supabase-auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const _user = await authUser(req, res); if (!_user) return

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')

  const since = typeof req.query.since === 'string' ? req.query.since : ''
  const until = typeof req.query.until === 'string' ? req.query.until : ''
  const totalLeads = 0 // CPL calculado no frontend com dados BQ

  const spendKeywords = (typeof req.query.spendFilter === 'string' ? req.query.spendFilter : '')
    .split(',').map(k => k.trim().toLowerCase()).filter(Boolean)

  const orKeywords = (typeof req.query.orFilter === 'string' ? req.query.orFilter : '')
    .split(',').map(k => k.trim().toLowerCase()).filter(Boolean)

  const accessToken = process.env.META_ACCESS_TOKEN ?? ''
  const adAccount = process.env.META_AD_ACCOUNT_ID ?? ''

  if (!accessToken || !adAccount) {
    return res.status(500).json({ error: 'META_ACCESS_TOKEN ou META_AD_ACCOUNT_ID não configurado' })
  }

  try {
    // 1) Lista de campanhas com spend no período
    const insightFields = 'campaign_id,campaign_name,spend'
    const campaignFields = `id,name,status,insights.time_range({"since":"${since}","until":"${until}"}){${insightFields}}`
    const mUrl = new URL(`https://graph.facebook.com/v19.0/${adAccount}/campaigns`)
    mUrl.searchParams.set('fields', campaignFields)
    mUrl.searchParams.set('access_token', accessToken)
    mUrl.searchParams.set('limit', '200')

    const mRes = await fetch(mUrl.toString())
    if (!mRes.ok) {
      const txt = await mRes.text()
      return res.status(502).json({ error: `Meta campaigns error: ${mRes.status}`, detail: txt.substring(0, 300) })
    }

    const mData = await mRes.json() as {
      data: Array<{ id: string; name: string; insights?: { data: Array<{ spend: string }> } }>
    }

    let totalSpend = 0
    const metaCampaigns: { name: string; spend: number }[] = []
    const matchedCampaignNames = new Set<string>()

    for (const c of mData.data ?? []) {
      const nameLower = c.name.toLowerCase()
      const matchesAnd = spendKeywords.length > 0 && spendKeywords.every(k => nameLower.includes(k))
      const matchesOr = orKeywords.length > 0 && orKeywords.some(k => nameLower.includes(k))
      if (matchesAnd || matchesOr) {
        const s = Number(c.insights?.data?.[0]?.spend ?? 0)
        totalSpend += s
        metaCampaigns.push({ name: c.name, spend: Math.round(s * 100) / 100 })
        matchedCampaignNames.add(c.name)
      }
    }

    const metaSpend = Math.round(totalSpend * 100) / 100
    const cpl = totalLeads > 0 ? Math.round((metaSpend / totalLeads) * 100) / 100 : null

    if (matchedCampaignNames.size === 0) {
      return res.json({ metaSpend: 0, cpl: null, metaCampaigns: [], dailyMeta: [], spendByUtm: undefined })
    }

    const timeRange = JSON.stringify({ since, until })

    // 2) Breakdown diário + ad insights em paralelo
    const dUrl = new URL(`https://graph.facebook.com/v19.0/${adAccount}/insights`)
    dUrl.searchParams.set('fields', 'date_start,spend,clicks,actions')
    dUrl.searchParams.set('time_increment', '1')
    dUrl.searchParams.set('time_range', timeRange)
    dUrl.searchParams.set('level', 'campaign')
    dUrl.searchParams.set('filtering', JSON.stringify([{ field: 'campaign.name', operator: 'CONTAIN', value: spendKeywords[0] ?? '' }]))
    dUrl.searchParams.set('limit', '1000')
    dUrl.searchParams.set('access_token', accessToken)

    const aiUrl = new URL(`https://graph.facebook.com/v19.0/${adAccount}/insights`)
    aiUrl.searchParams.set('fields', 'ad_name,adset_name,campaign_name,spend')
    aiUrl.searchParams.set('time_range', timeRange)
    aiUrl.searchParams.set('level', 'ad')
    aiUrl.searchParams.set('filtering', JSON.stringify([{ field: 'campaign.name', operator: 'CONTAIN', value: spendKeywords[0] ?? '' }]))
    aiUrl.searchParams.set('limit', '500')
    aiUrl.searchParams.set('access_token', accessToken)

    const [dRes, aiRes] = await Promise.all([fetch(dUrl.toString()), fetch(aiUrl.toString())])

    // Processa breakdown diário
    let dailyMeta: { date: string; spend: number; clicks: number; linkClicks: number; pageViews: number }[] = []
    if (dRes.ok) {
      const dData = await dRes.json() as {
        data: Array<{ date_start: string; spend: string; clicks: string; actions?: Array<{ action_type: string; value: string }> }>
      }
      const byDate = new Map<string, { spend: number; clicks: number; linkClicks: number; pageViews: number }>()
      for (const row of dData.data ?? []) {
        const d = row.date_start
        const cur = byDate.get(d) ?? { spend: 0, clicks: 0, linkClicks: 0, pageViews: 0 }
        const av = (type: string) => Number(row.actions?.find(a => a.action_type === type)?.value ?? 0)
        byDate.set(d, {
          spend: cur.spend + Number(row.spend ?? 0),
          clicks: cur.clicks + Number(row.clicks ?? 0),
          linkClicks: cur.linkClicks + av('link_click'),
          pageViews: cur.pageViews + av('landing_page_view'),
        })
      }
      dailyMeta = Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({
        date, spend: Math.round(v.spend * 100) / 100, clicks: v.clicks, linkClicks: v.linkClicks, pageViews: v.pageViews,
      }))
    }

    // Processa ad insights
    type AdRow = { ad_name?: string; adset_name?: string; campaign_name?: string; spend: string }
    let allAdRows: AdRow[] = []
    if (aiRes.ok) {
      const d = await aiRes.json() as { data: AdRow[] }
      allAdRows = d.data ?? []
    }

    // spendByUtm.campaign vem direto de metaCampaigns (já cobre AND + OR)
    // spendByUtm.medium e .content vem do ad insights (só BA25, sem Instagram)
    const utmSpend: Record<string, Record<string, number>> = { source: {}, medium: {}, campaign: {}, content: {}, term: {} }

    for (const c of metaCampaigns) {
      utmSpend.campaign[c.name] = Math.round(c.spend * 100) / 100
    }

    for (const row of allAdRows) {
      if (row.campaign_name && !matchedCampaignNames.has(row.campaign_name)) continue
      const spend = Number(row.spend ?? 0)
      if (!spend) continue
      if (row.adset_name) utmSpend.medium[row.adset_name] = (utmSpend.medium[row.adset_name] ?? 0) + spend
      if (row.ad_name) utmSpend.content[row.ad_name] = (utmSpend.content[row.ad_name] ?? 0) + spend
    }

    for (const dim of ['medium', 'content'] as const) {
      for (const key of Object.keys(utmSpend[dim])) {
        utmSpend[dim][key] = Math.round(utmSpend[dim][key] * 100) / 100
      }
    }

    const spendByUtm = utmSpend

    res.json({ metaSpend, cpl, metaCampaigns, dailyMeta, spendByUtm })
  } catch (err) {
    console.error('meta-spend error:', err)
    res.status(500).json({ error: 'Erro interno', detail: (err as Error).message })
  }
}
