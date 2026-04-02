import type { VercelRequest, VercelResponse } from '@vercel/node'
import { bqQuery, tableLeads } from './_bq.js'
import { authUser } from './_supabase-auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const _user = await authUser(req, res); if (!_user) return

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30')

  const query = typeof req.query.query === 'string' ? req.query.query.trim() : ''
  const tagFilter = typeof req.query.tag === 'string' ? req.query.tag.trim() : ''
  // cursor is now a numeric OFFSET (as string)
  const offset = Math.max(0, parseInt(typeof req.query.cursor === 'string' ? req.query.cursor : '0') || 0)

  const tLeads = tableLeads()

  // Build WHERE clause dynamically
  const whereParts: string[] = []
  if (tagFilter) whereParts.push('tag_name = @tagFilter')
  if (query) {
    whereParts.push(
      `(LOWER(lead_name) LIKE CONCAT('%', LOWER(@query), '%') OR LOWER(lead_email) LIKE CONCAT('%', LOWER(@query), '%'))`,
    )
  }
  const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''

  const params = [
    ...(tagFilter ? [{ name: 'tagFilter', value: tagFilter }] : []),
    ...(query ? [{ name: 'query', value: query }] : []),
    { name: 'offset', value: offset, type: 'INT64' as const },
  ]

  try {
    const [dataResult, countResult] = await Promise.all([
      bqQuery(
        `SELECT
           CAST(lead_id AS STRING) AS id,
           lead_name,
           lead_email,
           lead_phone,
           CAST(lead_register AS STRING) AS lead_register,
           tag_name,
           utm_source,
           utm_campaign
         FROM ${tLeads}
         ${where}
         ORDER BY lead_register DESC
         LIMIT 50
         OFFSET @offset`,
        params,
      ),
      bqQuery(`SELECT COUNT(*) AS cnt FROM ${tLeads} ${where}`, params.filter((p) => p.name !== 'offset')),
    ])

    const leads = dataResult.rows.map((row) => ({
      id: row.id ?? '',
      name: row.lead_name ?? 'Sem nome',
      email: row.lead_email ?? '',
      phone: row.lead_phone ?? undefined,
      tags: [row.tag_name].filter(Boolean) as string[],
      dateAdded: row.lead_register ?? '',
      utmSource: row.utm_source ?? undefined,
      utmCampaign: row.utm_campaign ?? undefined,
    }))

    const total = parseInt(countResult.rows[0]?.cnt ?? '0')
    const nextOffset = offset + 50
    const nextCursor = nextOffset < total ? String(nextOffset) : undefined

    res.json({ leads, total, nextCursor })
  } catch (err) {
    console.error('leads-data error:', err)
    res.status(500).json({ error: 'Erro interno' })
  }
}
