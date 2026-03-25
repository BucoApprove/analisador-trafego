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
  const prefixPattern = `${prefix}%`

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')

  const params = [
    { name: 'prefix', value: prefixPattern },
    { name: 'since', value: since },
    { name: 'until', value: until },
  ]

  try {
    const [rTotal, rByTag, rByDay, rBySource, rByCampaign] = await Promise.all([
      // Total de leads ÚNICOS com qualquer tag que comece com o prefix
      bqQuery(
        `SELECT COUNT(DISTINCT lead_id) AS cnt
         FROM ${tLeads}
         WHERE tag_name LIKE @prefix
           AND DATE(lead_register) BETWEEN DATE(@since) AND DATE(@until)`,
        params,
      ),

      // Contagem por tag (leads únicos dentro de cada tag)
      bqQuery(
        `SELECT tag_name, COUNT(DISTINCT lead_id) AS cnt
         FROM ${tLeads}
         WHERE tag_name LIKE @prefix
           AND DATE(lead_register) BETWEEN DATE(@since) AND DATE(@until)
         GROUP BY tag_name
         ORDER BY cnt DESC`,
        params,
      ),

      // Leads únicos por dia (primeiro contato do lead com qualquer tag do lançamento)
      bqQuery(
        `SELECT FORMAT_DATE('%Y-%m-%d', first_date) AS date, COUNT(*) AS count
         FROM (
           SELECT lead_id, MIN(DATE(lead_register)) AS first_date
           FROM ${tLeads}
           WHERE tag_name LIKE @prefix
             AND DATE(lead_register) BETWEEN DATE(@since) AND DATE(@until)
           GROUP BY lead_id
         )
         GROUP BY date
         ORDER BY date`,
        params,
      ),

      // Por utm_source
      bqQuery(
        `SELECT COALESCE(utm_source, '(direto)') AS name,
                COUNT(DISTINCT lead_id) AS value
         FROM ${tLeads}
         WHERE tag_name LIKE @prefix
           AND DATE(lead_register) BETWEEN DATE(@since) AND DATE(@until)
         GROUP BY name
         ORDER BY value DESC
         LIMIT 15`,
        params,
      ),

      // Por utm_campaign
      bqQuery(
        `SELECT COALESCE(utm_campaign, '(sem campanha)') AS name,
                COUNT(DISTINCT lead_id) AS value
         FROM ${tLeads}
         WHERE tag_name LIKE @prefix
           AND DATE(lead_register) BETWEEN DATE(@since) AND DATE(@until)
         GROUP BY name
         ORDER BY value DESC
         LIMIT 15`,
        params,
      ),
    ])

    const totalUnique = parseInt(rTotal.rows[0]?.cnt ?? '0')

    const byTag = rByTag.rows.map((r) => ({
      tag: r.tag_name as string,
      count: parseInt(r.cnt ?? '0'),
    }))

    const sumByTag = byTag.reduce((acc, t) => acc + t.count, 0)
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
