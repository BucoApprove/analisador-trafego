import type { VercelRequest, VercelResponse } from '@vercel/node'
import { bqQuery, tableLeads } from './_bq.js'
import { authUser } from './_supabase-auth.js'

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function firstOfMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const _user = await authUser(req, res); if (!_user) return

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
  const containsPattern = `%${prefix.toLowerCase()}%`
  const broadSearch = req.query.broadSearch === 'true'
  // tagFilter: case-insensitive via LOWER(). broadSearch também pega utm_campaign.
  const tagFilter = broadSearch
    ? `(LOWER(COALESCE(tag_name,'')) LIKE @pattern OR LOWER(COALESCE(utm_campaign,'')) LIKE @pattern)`
    : `LOWER(COALESCE(tag_name,'')) LIKE @pattern`

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')

  const paramsAll = [{ name: 'pattern', value: containsPattern }]

  try {
    // Query deduplicada por email+tag+data — frontend faz os cálculos
    const result = await bqQuery(
      `SELECT
         lead_email,
         tag_name,
         MIN(DATE(lead_register)) AS date,
         ANY_VALUE(utm_source)   AS utm_source,
         ANY_VALUE(utm_campaign) AS utm_campaign,
         ANY_VALUE(utm_medium)   AS utm_medium,
         ANY_VALUE(utm_content)  AS utm_content
       FROM ${tLeads}
       WHERE ${tagFilter}
       GROUP BY lead_email, tag_name`,
      paramsAll,
    )

    res.json({
      prefix,
      rows: result.rows,
      since,
      until,
    })
  } catch (err) {
    console.error('launch-data error:', err)
    res.status(500).json({ error: 'Erro interno', detail: (err as Error).message })
  }
}
