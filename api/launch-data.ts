import type { VercelRequest, VercelResponse } from '@vercel/node'
import { bqQuery, tableLeads } from './_bq.js'

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

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function firstOfMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!auth(req, res)) return

  const tLeads = tableLeads()

  // Sem prefix → retorna todas as tags disponíveis (para autocomplete/sugestão)
  const prefix = typeof req.query.prefix === 'string' ? req.query.prefix.trim() : ''
  if (!prefix) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')
    try {
      const result = await bqQuery(
        `SELECT DISTINCT tag_name FROM ${tLeads}
         WHERE tag_name IS NOT NULL
         ORDER BY tag_name`,
      )
      res.json({ tags: result.rows.map((r) => r.tag_name as string) })
    } catch (err) {
      console.error('launch-data (tags list) error:', err)
      res.status(500).json({ error: 'Erro interno' })
    }
    return
  }

  const since = typeof req.query.since === 'string' ? req.query.since : firstOfMonthStr()
  const until = typeof req.query.until === 'string' ? req.query.until : todayStr()
  const containsPattern = `%${prefix}%`
  const broadSearch = req.query.broadSearch === 'true'
  // tagFilter: com broadSearch também captura leads sem tag mas com utm_campaign contendo o prefixo
  const tagFilter = broadSearch
    ? `(tag_name LIKE @pattern OR LOWER(COALESCE(utm_campaign,'')) LIKE @utmPattern)`
    : `tag_name LIKE @pattern`

  // Palavras-chave para filtrar campanhas do Meta Ads (ex: "BA25")
  const spendFilterRaw = typeof req.query.spendFilter === 'string' ? req.query.spendFilter : ''
  const spendKeywords = spendFilterRaw
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)

  // Palavras-chave adicionais com lógica OR (ex: "instagram,engajamento,lembrete,remarketing")
  const orFilterRaw = typeof req.query.orFilter === 'string' ? req.query.orFilter : ''
  const orKeywords = orFilterRaw
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')

  const broadParam = broadSearch ? [{ name: 'utmPattern', value: `%${prefix.toLowerCase()}%` }] : []
  const paramsDate = [
    { name: 'pattern', value: containsPattern },
    { name: 'since', value: since },
    { name: 'until', value: until },
    ...broadParam,
  ]
  const paramsAll = [{ name: 'pattern', value: containsPattern }, ...broadParam]

  try {
    const [rAllTags, rTotalAll, rTotal, rByTagDate, rByDay, rBySource, rByCampaign, rByMedium, rByContent, rByTerm] = await Promise.all([
      // TODOS os tags que contêm o termo — SEM filtro de data (para não perder tags antigas)
      bqQuery(
        `SELECT tag_name, COUNT(DISTINCT lead_email) AS cnt_all
         FROM ${tLeads}
         WHERE ${tagFilter}
         GROUP BY tag_name
         ORDER BY cnt_all DESC`,
        paramsAll,
      ),

      // Total de leads ÚNICOS histórico — SEM filtro de data (número real do lançamento)
      bqQuery(
        `SELECT COUNT(DISTINCT lead_email) AS cnt
         FROM ${tLeads}
         WHERE ${tagFilter}`,
        paramsAll,
      ),

      // Total de leads ÚNICOS no período selecionado
      bqQuery(
        `SELECT COUNT(DISTINCT lead_email) AS cnt
         FROM ${tLeads}
         WHERE ${tagFilter}
           AND DATE(lead_register) BETWEEN DATE(@since) AND DATE(@until)`,
        paramsDate,
      ),

      // Contagem por tag no período (pode ser 0 para algumas tags)
      bqQuery(
        `SELECT tag_name, COUNT(DISTINCT lead_email) AS cnt
         FROM ${tLeads}
         WHERE ${tagFilter}
           AND DATE(lead_register) BETWEEN DATE(@since) AND DATE(@until)
         GROUP BY tag_name`,
        paramsDate,
      ),

      // Leads únicos por dia no período (primeiro contato do lead)
      bqQuery(
        `SELECT FORMAT_DATE('%Y-%m-%d', first_date) AS date, COUNT(*) AS count
         FROM (
           SELECT lead_email, MIN(DATE(lead_register)) AS first_date
           FROM ${tLeads}
           WHERE ${tagFilter}
             AND DATE(lead_register) BETWEEN DATE(@since) AND DATE(@until)
             AND lead_email IS NOT NULL
           GROUP BY lead_email
         )
         GROUP BY date
         ORDER BY date`,
        paramsDate,
      ),

      // Por utm_source no período
      bqQuery(
        `SELECT COALESCE(utm_source, '(direto)') AS name,
                COUNT(DISTINCT lead_email) AS value
         FROM ${tLeads}
         WHERE ${tagFilter}
           AND DATE(lead_register) BETWEEN DATE(@since) AND DATE(@until)
         GROUP BY name
         ORDER BY value DESC
         LIMIT 15`,
        paramsDate,
      ),

      // Por utm_campaign no período
      bqQuery(
        `SELECT COALESCE(utm_campaign, '(sem campanha)') AS name,
                COUNT(DISTINCT lead_email) AS value
         FROM ${tLeads}
         WHERE ${tagFilter}
           AND DATE(lead_register) BETWEEN DATE(@since) AND DATE(@until)
         GROUP BY name
         ORDER BY value DESC
         LIMIT 15`,
        paramsDate,
      ),

      // Por utm_medium
      bqQuery(
        `SELECT COALESCE(utm_medium, '(não informado)') AS name,
                COUNT(DISTINCT lead_email) AS value
         FROM ${tLeads}
         WHERE ${tagFilter}
           AND DATE(lead_register) BETWEEN DATE(@since) AND DATE(@until)
         GROUP BY name
         ORDER BY value DESC
         LIMIT 15`,
        paramsDate,
      ).catch(() => ({ rows: [] })),

      // Por utm_content
      bqQuery(
        `SELECT COALESCE(utm_content, '(não informado)') AS name,
                COUNT(DISTINCT lead_email) AS value
         FROM ${tLeads}
         WHERE ${tagFilter}
           AND DATE(lead_register) BETWEEN DATE(@since) AND DATE(@until)
         GROUP BY name
         ORDER BY value DESC
         LIMIT 15`,
        paramsDate,
      ).catch(() => ({ rows: [] })),

      // Por utm_term
      bqQuery(
        `SELECT COALESCE(utm_term, '(não informado)') AS name,
                COUNT(DISTINCT lead_email) AS value
         FROM ${tLeads}
         WHERE ${tagFilter}
           AND DATE(lead_register) BETWEEN DATE(@since) AND DATE(@until)
         GROUP BY name
         ORDER BY value DESC
         LIMIT 15`,
        paramsDate,
      ).catch(() => ({ rows: [] })),
    ])

    // Mapa de contagem no período por tag
    const countInPeriod = new Map<string, number>(
      rByTagDate.rows.map((r) => [r.tag_name as string, parseInt(r.cnt ?? '0')])
    )

    // Combina: todas as tags (histórico), sobrepõe contagem do período
    const byTag = rAllTags.rows.map((r) => ({
      tag: r.tag_name as string,
      countAll: parseInt(r.cnt_all ?? '0'),
      countPeriod: countInPeriod.get(r.tag_name as string) ?? 0,
    }))

    const totalUniqueAll = parseInt(rTotalAll.rows[0]?.cnt ?? '0')
    const totalUnique = parseInt(rTotal.rows[0]?.cnt ?? '0')
    const sumByTag = byTag.reduce((acc, t) => acc + t.countAll, 0)
    const overlap = sumByTag - totalUniqueAll

    // ---------- Meta Ads spend (opcional) ----------
    let metaSpend: number | null = null
    let cpl: number | null = null
    let metaCampaigns: { name: string; spend: number }[] = []
    let dailyMeta: { date: string; spend: number; clicks: number; linkClicks: number; pageViews: number }[] = []
    let spendByUtm: { source: Record<string, number>; medium: Record<string, number>; campaign: Record<string, number>; content: Record<string, number>; term: Record<string, number> } | undefined = undefined
    let _metaAdDebug: Record<string, unknown> = {}

    if (spendKeywords.length > 0) {
      const accessToken = process.env.META_ACCESS_TOKEN ?? ''
      const adAccount = process.env.META_AD_ACCOUNT_ID ?? ''
      if (accessToken && adAccount) {
        try {
          const insightFields = 'campaign_id,campaign_name,spend'
          const campaignFields = `id,name,status,insights.time_range({"since":"${since}","until":"${until}"}){${insightFields}}`
          const mUrl = new URL(`https://graph.facebook.com/v19.0/${adAccount}/campaigns`)
          mUrl.searchParams.set('fields', campaignFields)
          mUrl.searchParams.set('access_token', accessToken)
          mUrl.searchParams.set('limit', '200')

          const mRes = await fetch(mUrl.toString())
          if (mRes.ok) {
            const mData = await mRes.json() as {
              data: Array<{ id: string; name: string; insights?: { data: Array<{ spend: string }> } }>
            }
            let totalSpend = 0
            const matchedIds: string[] = []
            for (const c of mData.data ?? []) {
              const nameLower = c.name.toLowerCase()
              const matchesAnd = spendKeywords.length > 0 && spendKeywords.every((k) => nameLower.includes(k))
              const matchesOr = orKeywords.length > 0 && orKeywords.some((k) => nameLower.includes(k))
              if (matchesAnd || matchesOr) {
                const s = Number(c.insights?.data?.[0]?.spend ?? 0)
                totalSpend += s
                metaCampaigns.push({ name: c.name, spend: Math.round(s * 100) / 100 })
                matchedIds.push(c.id)
              }
            }
            metaSpend = Math.round(totalSpend * 100) / 100
            cpl = totalUniqueAll > 0 ? Math.round((metaSpend / totalUniqueAll) * 100) / 100 : null

            // Busca breakdown diário + gasto por anúncio (para CPL por UTM) em paralelo
            if (matchedIds.length > 0) {
              const timeRange = JSON.stringify({ since, until })
              // Set com todos os nomes de campanha coletados (AND + OR)
              const matchedCampaignNames = new Set(metaCampaigns.map(c => c.name))

              // 1) Breakdown diário — filtra por nome (BA25) para evitar lista longa de IDs
              const dFiltering = JSON.stringify([{ field: 'campaign.name', operator: 'CONTAIN', value: spendKeywords[0] ?? prefix }])
              const dUrl = new URL(`https://graph.facebook.com/v19.0/${adAccount}/insights`)
              dUrl.searchParams.set('fields', 'date_start,spend,clicks,actions')
              dUrl.searchParams.set('time_increment', '1')
              dUrl.searchParams.set('time_range', timeRange)
              dUrl.searchParams.set('level', 'campaign')
              dUrl.searchParams.set('filtering', dFiltering)
              dUrl.searchParams.set('limit', '1000')
              dUrl.searchParams.set('access_token', accessToken)

              // 2) Ad insights — uma chamada por BA25 + uma chamada cobrindo todas as OR keywords
              //    Filtragem final feita em JS pelo matchedCampaignNames (evita múltiplas chamadas)
              const aiFiltering = JSON.stringify([{ field: 'campaign.name', operator: 'CONTAIN', value: spendKeywords[0] ?? prefix }])
              const aiUrl = new URL(`https://graph.facebook.com/v19.0/${adAccount}/insights`)
              aiUrl.searchParams.set('fields', 'ad_id,ad_name,adset_name,campaign_name,spend')
              aiUrl.searchParams.set('time_range', timeRange)
              aiUrl.searchParams.set('level', 'ad')
              aiUrl.searchParams.set('filtering', aiFiltering)
              aiUrl.searchParams.set('limit', '500')
              aiUrl.searchParams.set('access_token', accessToken)

              // Chamada extra apenas para OR keywords (uma única chamada com o primeiro OR keyword como âncora)
              // Os demais OR são filtrados em JS pelo matchedCampaignNames
              const orAiUrls = orKeywords.slice(0, 1).map(kw => {
                const u = new URL(`https://graph.facebook.com/v19.0/${adAccount}/insights`)
                u.searchParams.set('fields', 'ad_id,ad_name,adset_name,campaign_name,spend')
                u.searchParams.set('time_range', timeRange)
                u.searchParams.set('level', 'ad')
                u.searchParams.set('filtering', JSON.stringify([{ field: 'campaign.name', operator: 'CONTAIN', value: kw }]))
                u.searchParams.set('limit', '500')
                u.searchParams.set('access_token', accessToken)
                return u
              })

              const [dRes, aiRes, ...orAiReses] = await Promise.all([
                fetch(dUrl.toString()),
                fetch(aiUrl.toString()),
                ...orAiUrls.map(u => fetch(u.toString())),
              ])

              // Processa breakdown diário
              if (dRes.ok) {
                const dData = await dRes.json() as {
                  data: Array<{
                    date_start: string
                    spend: string
                    clicks: string
                    actions?: Array<{ action_type: string; value: string }>
                  }>
                }
                const byDate = new Map<string, { spend: number; clicks: number; linkClicks: number; pageViews: number }>()
                for (const row of dData.data ?? []) {
                  const d = row.date_start
                  const cur = byDate.get(d) ?? { spend: 0, clicks: 0, linkClicks: 0, pageViews: 0 }
                  const actionVal = (type: string) =>
                    Number(row.actions?.find(a => a.action_type === type)?.value ?? 0)
                  byDate.set(d, {
                    spend: cur.spend + Number(row.spend ?? 0),
                    clicks: cur.clicks + Number(row.clicks ?? 0),
                    linkClicks: cur.linkClicks + actionVal('link_click'),
                    pageViews: cur.pageViews + actionVal('landing_page_view'),
                  })
                }
                dailyMeta = Array.from(byDate.entries())
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([date, v]) => ({
                    date,
                    spend: Math.round(v.spend * 100) / 100,
                    clicks: v.clicks,
                    linkClicks: v.linkClicks,
                    pageViews: v.pageViews,
                  }))
              }

              // Processa gasto por UTM via nomes Meta → utm_campaign/medium/content
              type AdRow = { ad_id: string; ad_name?: string; adset_name?: string; campaign_name?: string; spend: string }
              let allAdRows: AdRow[] = []

              if (!aiRes.ok) {
                const errTxt = await aiRes.text()
                console.error('Meta ad insights failed:', aiRes.status, errTxt)
                _metaAdDebug.aiError = `${aiRes.status}: ${errTxt.substring(0, 200)}`
              } else {
                const aiData = await aiRes.json() as { data: AdRow[] }
                allAdRows = allAdRows.concat(aiData.data ?? [])
              }

              // Processa respostas das chamadas OR (ex: Instagram)
              for (const orRes of orAiReses) {
                if (orRes.ok) {
                  const orData = await orRes.json() as { data: AdRow[] }
                  allAdRows = allAdRows.concat(orData.data ?? [])
                }
              }

              _metaAdDebug.aiRows = allAdRows.length
              _metaAdDebug.firstRow = allAdRows[0] ?? null

              if (allAdRows.length > 0) {
                const utmSpend: Record<string, Record<string, number>> = {
                  source: {}, medium: {}, campaign: {}, content: {}, term: {},
                }

                for (const row of allAdRows) {
                  // Só processa linhas de campanhas que fazem parte deste lançamento
                  if (row.campaign_name && !matchedCampaignNames.has(row.campaign_name)) continue
                  const spend = Number(row.spend ?? 0)
                  if (!spend) continue
                  if (row.campaign_name) {
                    utmSpend.campaign[row.campaign_name] = (utmSpend.campaign[row.campaign_name] ?? 0) + spend
                  }
                  if (row.adset_name) {
                    utmSpend.medium[row.adset_name] = (utmSpend.medium[row.adset_name] ?? 0) + spend
                  }
                  if (row.ad_name) {
                    utmSpend.content[row.ad_name] = (utmSpend.content[row.ad_name] ?? 0) + spend
                  }
                }

                for (const dim of ['source', 'medium', 'campaign', 'content', 'term'] as const) {
                  for (const key of Object.keys(utmSpend[dim])) {
                    utmSpend[dim][key] = Math.round(utmSpend[dim][key] * 100) / 100
                  }
                }

                spendByUtm = utmSpend
              }
            }
          }
        } catch (err) {
          console.error('launch-data Meta spend error:', err)
          // silencia — spend é opcional
        }
      }
    }
    // -----------------------------------------------

    res.json({
      prefix,
      byTag,
      totalUniqueAll,
      totalUnique,
      sumByTag,
      overlap,
      leadsByDay: rByDay.rows.map((r) => ({
        date: r.date as string,
        count: parseInt(r.count ?? '0'),
      })),
      bySource: rBySource.rows.map((r) => ({
        name: r.name as string,
        value: parseInt(r.value ?? '0'),
      })),
      byCampaign: rByCampaign.rows.map((r) => ({
        name: r.name as string,
        value: parseInt(r.value ?? '0'),
      })),
      byMedium: rByMedium.rows.map((r) => ({
        name: r.name as string,
        value: parseInt(r.value ?? '0'),
      })),
      byContent: rByContent.rows.map((r) => ({
        name: r.name as string,
        value: parseInt(r.value ?? '0'),
      })),
      byTerm: rByTerm.rows.map((r) => ({
        name: r.name as string,
        value: parseInt(r.value ?? '0'),
      })),
      dateRange: { since, until },
      ...(metaSpend !== null ? { metaSpend, cpl, metaCampaigns, dailyMeta, ...(spendByUtm ? { spendByUtm } : {}), _metaAdDebug } : {}),
    })
  } catch (err) {
    console.error('launch-data error:', err)
    res.status(500).json({ error: 'Erro interno' })
  }
}
