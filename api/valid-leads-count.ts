import type { VercelRequest, VercelResponse } from '@vercel/node'
import { bqQuery, tableLeads, tableVendas } from './_bq.js'
import { authUser } from './_supabase-auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const _user = await authUser(req, res); if (!_user) return

  const since = typeof req.query.since === 'string' ? req.query.since : ''
  const until = typeof req.query.until === 'string' ? req.query.until : ''

  if (!since || !until) {
    return res.status(400).json({ error: 'Parâmetros since e until são obrigatórios' })
  }

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')

  const tLeads  = tableLeads()
  const tVendas = tableVendas()

  const dateParams = [
    { name: 'since', value: since, type: 'DATE' as const },
    { name: 'until', value: until, type: 'DATE' as const },
  ]
  const baseWhere = `DATE(lead_register) >= @since AND DATE(lead_register) <= @until`

  try {
    // Decodifica caracteres URL-encoded comuns em UTMs
  // Cobre: %5B=[, %5D=], %20=espaço, +=espaço, %28=(, %29=), %2C=,, %2F=/, %3A=:
  const decodeUtm = (col: string) =>
    `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(` +
    `${col}, '%5B', '['), '%5b', '['), '%5D', ']'), '%5d', ']'), '%20', ' '), '+', ' '), '%28', '('), '%29', ')'), '%2C', ',')`

  const [campaignResult, contentResult, salesResult] = await Promise.all([
      bqQuery(
        `SELECT
           ${decodeUtm('utm_campaign')} AS key,
           COUNT(DISTINCT lead_email) AS cnt
         FROM ${tLeads}
         WHERE utm_campaign IS NOT NULL AND utm_campaign != '' AND ${baseWhere}
         GROUP BY 1`,
        dateParams,
      ),
      bqQuery(
        `SELECT
           ${decodeUtm('utm_campaign')} AS campaign,
           ${decodeUtm('utm_medium')}   AS medium,
           ${decodeUtm('utm_content')}  AS content,
           COUNT(DISTINCT lead_email) AS cnt
         FROM ${tLeads}
         WHERE utm_campaign IS NOT NULL AND utm_campaign != ''
           AND utm_content  IS NOT NULL AND utm_content  != ''
           AND ${baseWhere}
         GROUP BY 1, 2, 3`,
        dateParams,
      ),
      bqQuery(
        `SELECT
           ${decodeUtm('l.utm_campaign')} AS key,
           COUNT(DISTINCT LOWER(TRIM(l.lead_email))) AS cnt
         FROM ${tLeads} l
         INNER JOIN ${tVendas} s
           ON LOWER(TRIM(l.lead_email)) = LOWER(TRIM(s.E_mail_do_Comprador))
         WHERE
           l.utm_campaign IS NOT NULL AND l.utm_campaign != ''
           AND ${baseWhere}
           AND DATE(s.Data_do_Pedido) >= DATE(l.lead_register)
         GROUP BY 1`,
        dateParams,
      ),
    ])

    const norm = (s: string) => s.toLowerCase().trim()

    const counts: Record<string, number> = {}
    for (const row of campaignResult.rows) {
      if (row.key) counts[norm(row.key)] = parseInt(row.cnt ?? '0')
    }

    // Chave composta campaign|||medium|||content para filtrar corretamente por campanha+conjunto+criativo
    const contentCounts: Record<string, number> = {}
    for (const row of contentResult.rows) {
      if (row.content) {
        const key = `${norm(row.campaign ?? '')}|||${norm(row.medium ?? '')}|||${norm(row.content)}`
        contentCounts[key] = parseInt(row.cnt ?? '0')
      }
    }

    const salesCounts: Record<string, number> = {}
    for (const row of salesResult.rows) {
      if (row.key) salesCounts[norm(row.key)] = parseInt(row.cnt ?? '0')
    }

    res.json({ counts, contentCounts, salesCounts, since, until })
  } catch (err) {
    console.error('valid-leads-count error:', err)
    res.status(500).json({ error: 'Erro interno ao consultar leads' })
  }
}
