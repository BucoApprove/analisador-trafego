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

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')

  const paramsDate = [
    { name: 'pattern', value: containsPattern },
    { name: 'since', value: since },
    { name: 'until', value: until },
  ]
  const paramsAll = [{ name: 'pattern', value: containsPattern }]

  try {
    const [rAllTags, rTotal, rByTagDate, rByDay, rBySource, rByCampaign] = await Promise.all([
      // TODOS os tags que contêm o termo — SEM filtro de data (para não perder tags antigas)
      bqQuery(
        `SELECT tag_name, COUNT(DISTINCT lead_id) AS cnt_all
         FROM ${tLeads}
         WHERE tag_name LIKE @pattern
         GROUP BY tag_name
         ORDER BY cnt_all DESC`,
        paramsAll,
      ),

      // Total de leads ÚNICOS no período selecionado
      bqQuery(
        `SELECT COUNT(DISTINCT lead_id) AS cnt
         FROM ${tLeads}
         WHERE tag_name LIKE @pattern
           AND DATE(lead_register) BETWEEN DATE(@since) AND DATE(@until)`,
        paramsDate,
      ),

      // Contagem por tag no período (pode ser 0 para algumas tags)
      bqQuery(
        `SELECT tag_name, COUNT(DISTINCT lead_id) AS cnt
         FROM ${tLeads}
         WHERE tag_name LIKE @pattern
           AND DATE(lead_register) BETWEEN DATE(@since) AND DATE(@until)
         GROUP BY tag_name`,
        paramsDate,
      ),

      // Leads únicos por dia no período (primeiro contato do lead)
      bqQuery(
        `SELECT FORMAT_DATE('%Y-%m-%d', first_date) AS date, COUNT(*) AS count
         FROM (
           SELECT lead_id, MIN(DATE(lead_register)) AS first_date
           FROM ${tLeads}
           WHERE tag_name LIKE @pattern
             AND DATE(lead_register) BETWEEN DATE(@since) AND DATE(@until)
           GROUP BY lead_id
         )
         GROUP BY date
         ORDER BY date`,
        paramsDate,
      ),

      // Por utm_source no período
      bqQuery(
        `SELECT COALESCE(utm_source, '(direto)') AS name,
                COUNT(DISTINCT lead_id) AS value
         FROM ${tLeads}
         WHERE tag_name LIKE @pattern
           AND DATE(lead_register) BETWEEN DATE(@since) AND DATE(@until)
         GROUP BY name
         ORDER BY value DESC
         LIMIT 15`,
        paramsDate,
      ),

      // Por utm_campaign no período
      bqQuery(
        `SELECT COALESCE(utm_campaign, '(sem campanha)') AS name,
                COUNT(DISTINCT lead_id) AS value
         FROM ${tLeads}
         WHERE tag_name LIKE @pattern
           AND DATE(lead_register) BETWEEN DATE(@since) AND DATE(@until)
         GROUP BY name
         ORDER BY value DESC
         LIMIT 15`,
        paramsDate,
      ),
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

    const totalUnique = parseInt(rTotal.rows[0]?.cnt ?? '0')
    const sumByTag = byTag.reduce((acc, t) => acc + t.countPeriod, 0)
    const overlap = sumByTag - totalUnique

    res.json({
      prefix,
      byTag,
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
      dateRange: { since, until },
    })
  } catch (err) {
    console.error('launch-data error:', err)
    res.status(500).json({ error: 'Erro interno' })
  }
}
