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

  try {
    const result = await bqQuery(
      `SELECT
         REPLACE(REPLACE(utm_campaign, '%20', ' '), '+', ' ') AS campaign_key,
         COUNT(*) AS cnt
       FROM ${tLeads}
       WHERE
         utm_campaign IS NOT NULL
         AND utm_campaign != ''
         AND DATE(lead_register) >= @since
         AND DATE(lead_register) <= @until
       GROUP BY 1`,
      [
        { name: 'since', value: since, type: 'DATE' },
        { name: 'until', value: until, type: 'DATE' },
      ],
    )

    const counts: Record<string, number> = {}
    for (const row of result.rows) {
      if (row.campaign_key) {
        counts[row.campaign_key] = parseInt(row.cnt ?? '0')
      }
    }

    res.json({ counts, since, until })
  } catch (err) {
    console.error('valid-leads-count error:', err)
    res.status(500).json({ error: 'Erro interno ao consultar leads' })
  }
}
