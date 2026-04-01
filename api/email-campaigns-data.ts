import type { VercelRequest, VercelResponse } from '@vercel/node'
import { bqQuery, tableLeads, tableVendas } from './_bq.js'

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
  const tVendas = tableVendas()

  try {
    // Registrations per tag_name (repurposes the "email waves" concept as "events/tags")
    const [rWaves, rInscritos, rCompradores] = await Promise.all([
      bqQuery(
        `SELECT tag_name, COUNT(DISTINCT lead_id) AS cnt
         FROM ${tLeads}
         GROUP BY tag_name
         ORDER BY cnt DESC`,
      ),
      bqQuery(
        `SELECT COUNT(DISTINCT lead_id) AS cnt FROM ${tLeads} WHERE tag_name = @tag`,
        [{ name: 'tag', value: tagInscrito }],
      ),
      bqQuery(`SELECT COUNT(*) AS cnt FROM ${tVendas} WHERE Status = 'COMPLETO'`),
    ])

    const waves = rWaves.rows.map((row) => ({
      tag: row.tag_name ?? '',
      label: row.tag_name ?? '',
      count: parseInt(row.cnt ?? '0'),
    }))

    const totalInscritos = parseInt(rInscritos.rows[0]?.cnt ?? '0')
    const totalCompradores = parseInt(rCompradores.rows[0]?.cnt ?? '0')

    res.json({ waves, totalInscritos, totalCompradores })
  } catch (err) {
    console.error('email-campaigns-data error:', err)
    res.status(500).json({ error: 'Erro interno' })
  }
}
