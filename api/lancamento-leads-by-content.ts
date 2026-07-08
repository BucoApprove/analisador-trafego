/**
 * Leads reais (BigQuery) por campanha + conjunto + anúncio, para cruzar com
 * a árvore Campanha→Conjunto→Anúncio da Meta (api/lancamento-ads-tree.ts).
 * Fonte de verdade do "custo por lead" no drill-down estrutural do lançamento
 * — a Meta só entra como comparação secundária.
 *
 * GET /api/lancamento-leads-by-content?prefix=BA26&since=YYYY-MM-DD&until=YYYY-MM-DD&broadSearch=true
 * Retorna { leadsByContent: { "campanha|||conjunto|||anúncio": leads_únicos } }
 * Chave normalizada (lowercase + trim), casando com utm_campaign/utm_medium/utm_content.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { bqQuery, tableLeads } from './_bq.js'
import { authUser } from './_supabase-auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const _user = await authUser(req, res); if (!_user) return

  const prefix = typeof req.query.prefix === 'string' ? req.query.prefix.trim() : ''
  const since = typeof req.query.since === 'string' ? req.query.since : ''
  const until = typeof req.query.until === 'string' ? req.query.until : ''
  if (!prefix || !since || !until) {
    return res.status(400).json({ error: 'prefix, since e until são obrigatórios' })
  }

  const tLeads = tableLeads()
  const containsPattern = `%${prefix.toLowerCase()}%`
  const broadSearch = req.query.broadSearch === 'true'
  const tagFilter = broadSearch
    ? `(LOWER(COALESCE(tag_name,'')) LIKE @pattern OR LOWER(COALESCE(utm_campaign,'')) LIKE @pattern)`
    : `LOWER(COALESCE(tag_name,'')) LIKE @pattern`

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')

  const params = [
    { name: 'pattern', value: containsPattern },
    { name: 'since', value: since, type: 'DATE' as const },
    { name: 'until', value: until, type: 'DATE' as const },
  ]

  try {
    const result = await bqQuery(
      `SELECT
         utm_campaign AS campaign,
         utm_medium   AS medium,
         utm_content  AS content,
         COUNT(DISTINCT lead_email) AS cnt
       FROM ${tLeads}
       WHERE ${tagFilter}
         AND utm_campaign IS NOT NULL AND utm_campaign != ''
         AND utm_content  IS NOT NULL AND utm_content  != ''
         AND DATE(lead_register) >= @since AND DATE(lead_register) <= @until
       GROUP BY 1, 2, 3`,
      params,
    )

    const norm = (s: string) => s.toLowerCase().trim()
    const leadsByContent: Record<string, number> = {}
    for (const row of result.rows as Array<{ campaign?: string; medium?: string; content?: string; cnt?: string }>) {
      if (!row.content) continue
      const key = `${norm(row.campaign ?? '')}|||${norm(row.medium ?? '')}|||${norm(row.content)}`
      leadsByContent[key] = parseInt(row.cnt ?? '0')
    }

    res.json({ leadsByContent })
  } catch (err) {
    console.error('lancamento-leads-by-content error:', err)
    res.status(500).json({ error: 'Erro interno', detail: (err as Error).message })
  }
}
