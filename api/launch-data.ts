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
