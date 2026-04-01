import type { VercelRequest, VercelResponse } from '@vercel/node'
import { bqQuery, tableLeads } from './_bq.js'

function auth(req: VercelRequest, res: VercelResponse): boolean {
  const token = process.env.DASHBOARD_TOKEN
  const header = req.headers.authorization ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!provided || (provided !== token && provided !== process.env.DASHBOARD_TOKEN_ADMIN)) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!auth(req, res)) return

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')

  const tagInscrito = process.env.TAG_INSCRITO ?? ''
  const tLeads = tableLeads()

  try {
    const { rows } = await bqQuery(
      `SELECT
         CAST(lead_id AS STRING) AS id,
         lead_name,
         lead_email,
         lead_phone,
         CAST(lead_register AS STRING) AS lead_register,
         tag_name,
         utm_source,
         utm_medium
       FROM ${tLeads}
       WHERE tag_name = @tag
       ORDER BY lead_register DESC
       LIMIT 50000`,
      [{ name: 'tag', value: tagInscrito }],
    )

    const subscribers = rows.map((row) => ({
      id: row.id ?? '',
      name: row.lead_name ?? 'Sem nome',
      email: row.lead_email ?? '',
      phone: row.lead_phone ?? undefined,
      // utm_medium used as audience/profissao proxy
      profissao: row.utm_medium ?? undefined,
      fonte: row.utm_source ?? undefined,
      inscricaoDate: row.lead_register ?? undefined,
      tags: [row.tag_name].filter(Boolean) as string[],
    }))

    res.json({ subscribers, total: subscribers.length })
  } catch (err) {
    console.error('subscriber-emails error:', err)
    res.status(500).json({ error: 'Erro interno' })
  }
}
