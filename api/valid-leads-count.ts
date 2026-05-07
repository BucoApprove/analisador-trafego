import type { VercelRequest, VercelResponse } from '@vercel/node'
import { bqQuery, tableLeads } from './_bq.js'
import { authUser } from './_supabase-auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const _user = await authUser(req, res); if (!_user) return

  const since = typeof req.query.since === 'string' ? req.query.since : ''
  const until = typeof req.query.until === 'string' ? req.query.until : ''

  if (!since || !until) {
    return res.status(400).json({ error: 'Parâmetros since e until são obrigatórios' })
  }

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')

  const tLeads = tableLeads()

  const dateParams = [
    { name: 'since', value: since, type: 'DATE' as const },
    { name: 'until', value: until, type: 'DATE' as const },
  ]
  const baseWhere = `DATE(lead_register) >= @since AND DATE(lead_register) <= @until`

  try {
    const [campaignResult, contentResult] = await Promise.all([
      bqQuery(
        `SELECT
           REPLACE(REPLACE(utm_campaign, '%20', ' '), '+', ' ') AS key,
           COUNT(*) AS cnt
         FROM ${tLeads}
         WHERE utm_campaign IS NOT NULL AND utm_campaign != '' AND ${baseWhere}
         GROUP BY 1`,
        dateParams,
      ),
      bqQuery(
        `SELECT
           REPLACE(REPLACE(utm_content, '%20', ' '), '+', ' ') AS key,
           COUNT(*) AS cnt
         FROM ${tLeads}
         WHERE utm_content IS NOT NULL AND utm_content != '' AND ${baseWhere}
         GROUP BY 1`,
        dateParams,
      ),
    ])

    const counts: Record<string, number> = {}
    for (const row of campaignResult.rows) {
      if (row.key) counts[row.key] = parseInt(row.cnt ?? '0')
    }

    const contentCounts: Record<string, number> = {}
    for (const row of contentResult.rows) {
      if (row.key) contentCounts[row.key] = parseInt(row.cnt ?? '0')
    }

    res.json({ counts, contentCounts, since, until })
  } catch (err) {
    console.error('valid-leads-count error:', err)
    res.status(500).json({ error: 'Erro interno ao consultar leads' })
  }
}
