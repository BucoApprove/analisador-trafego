import type { VercelRequest, VercelResponse } from '@vercel/node'
import { bqQuery, tableLeads, tableVendas } from './_bq.js'

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!auth(req, res)) return

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')

  // TAG_INSCRITO: tag_name value identifying registrations for the current event
  const tagInscrito = process.env.TAG_INSCRITO ?? ''
  const tLeads = tableLeads()
  const tVendas = tableVendas()

  try {
    const [rTotal, rCompradores, rPorDia, rPorFonte, rPorCampanha, rPorMedium] =
      await Promise.all([
        // Total inscritos
        bqQuery(
          `SELECT COUNT(DISTINCT lead_id) AS cnt FROM ${tLeads} WHERE tag_name = @tag`,
          [{ name: 'tag', value: tagInscrito }],
        ),
        // Total compradores (vendas com status COMPLETO)
        bqQuery(`SELECT COUNT(*) AS cnt FROM ${tVendas} WHERE Status = 'COMPLETO'`),
        // Inscritos por dia
        bqQuery(
          `SELECT FORMAT_DATE('%Y-%m-%d', lead_register) AS date, COUNT(DISTINCT lead_id) AS count
           FROM ${tLeads} WHERE tag_name = @tag AND lead_register IS NOT NULL
           GROUP BY date ORDER BY date`,
          [{ name: 'tag', value: tagInscrito }],
        ),
        // Por utm_source (fonte)
        bqQuery(
          `SELECT COALESCE(utm_source, 'Direto') AS name, COUNT(DISTINCT lead_id) AS value
           FROM ${tLeads} WHERE tag_name = @tag
           GROUP BY name ORDER BY value DESC`,
          [{ name: 'tag', value: tagInscrito }],
        ),
        // Por utm_campaign (top 10)
        bqQuery(
          `SELECT COALESCE(utm_campaign, 'Sem campanha') AS name, COUNT(DISTINCT lead_id) AS value
           FROM ${tLeads} WHERE tag_name = @tag
           GROUP BY name ORDER BY value DESC LIMIT 10`,
          [{ name: 'tag', value: tagInscrito }],
        ),
        // Por utm_medium (audiência — substitui "profissão")
        bqQuery(
          `SELECT COALESCE(utm_medium, 'Não informado') AS name, COUNT(DISTINCT lead_id) AS value
           FROM ${tLeads} WHERE tag_name = @tag
           GROUP BY name ORDER BY value DESC LIMIT 10`,
          [{ name: 'tag', value: tagInscrito }],
        ),
      ])

    const total = parseInt(rTotal.rows[0]?.cnt ?? '0')
    const totalCompradores = parseInt(rCompradores.rows[0]?.cnt ?? '0')

    const inscritosPorDia = rPorDia.rows.map((r) => ({
      date: r.date ?? '',
      count: parseInt(r.count ?? '0'),
    }))

    const inscritosPorFonte = rPorFonte.rows.map((r) => ({
      name: r.name ?? 'Direto',
      value: parseInt(r.value ?? '0'),
    }))

    const inscritosPorCampanha = rPorCampanha.rows.map((r) => ({
      name: r.name ?? 'Sem campanha',
      value: parseInt(r.value ?? '0'),
    }))

    // inscritosPorProfissao is now sourced from utm_medium (audience segments)
    const inscritosPorProfissao = rPorMedium.rows.map((r) => ({
      name: r.name ?? 'Não informado',
      value: parseInt(r.value ?? '0'),
    }))

    res.json({
      inscritos: total,
      compradores: totalCompradores,
      conversao: total > 0 ? (totalCompradores / total) * 100 : 0,
      inscritosPorDia,
      inscritosPorProfissao,
      inscritosPorFonte,
      inscritosPorCampanha,
    })
  } catch (err) {
    console.error('dashboard-data error:', err)
    res.status(500).json({ error: 'Erro interno' })
  }
}
