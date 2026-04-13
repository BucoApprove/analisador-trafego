/**
 * Análise UTM e comportamento de compra para os leads filtrados.
 *
 * GET /api/leads-analysis?type=utm&query=&tag=
 *   → retorna distribuição de leads por utm_source, _campaign, _medium, _content
 *
 * GET /api/leads-analysis?type=behavior&query=&tag=
 *   → retorna comportamento de compra antes/depois da entrada dos leads filtrados
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { QueryParam } from './_bq.js'
import { bqQuery, tableLeads, tableVendas } from './_bq.js'

function auth(req: VercelRequest, res: VercelResponse): boolean {
  const header = req.headers.authorization ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  const ok =
    (provided && provided === process.env.DASHBOARD_TOKEN_ADMIN) ||
    (provided && provided === process.env.DASHBOARD_TOKEN)
  if (!ok) { res.status(401).json({ error: 'Unauthorized' }); return false }
  return true
}

/** Builds a WHERE clause matching the same filters as leads-data.ts */
function buildLeadsWhere(query: string, tag: string): { sql: string; params: QueryParam[] } {
  const parts: string[] = []
  const params: QueryParam[] = []
  if (tag) {
    parts.push('tag_name = @tag')
    params.push({ name: 'tag', value: tag })
  }
  if (query) {
    parts.push(`(LOWER(lead_name) LIKE CONCAT('%', LOWER(@query), '%') OR LOWER(lead_email) LIKE CONCAT('%', LOWER(@query), '%'))`)
    params.push({ name: 'query', value: query })
  }
  return {
    sql: parts.length > 0 ? `WHERE ${parts.join(' AND ')}` : '',
    params,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!auth(req, res)) return

  const type = typeof req.query.type === 'string' ? req.query.type : 'utm'
  const query = typeof req.query.query === 'string' ? req.query.query.trim() : ''
  const tag = typeof req.query.tag === 'string' ? req.query.tag.trim() : ''

  const tLeads = tableLeads()
  const tVendas = tableVendas()
  const { sql: whereLeads, params: leadsParams } = buildLeadsWhere(query, tag)

  // ── UTM distribution ─────────────────────────────────────────────────────
  if (type === 'utm') {
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=30')

    function utmSql(col: string): string {
      return `SELECT ${col} AS val, COUNT(DISTINCT lead_email) AS cnt
              FROM ${tLeads} ${whereLeads}
              AND ${col} IS NOT NULL AND TRIM(${col}) != ''
              GROUP BY ${col} ORDER BY cnt DESC LIMIT 25`
    }
    // Fix WHERE keyword when whereLeads is empty
    function utmSqlFixed(col: string): string {
      const where = whereLeads ? `${whereLeads} AND` : 'WHERE'
      return `SELECT ${col} AS val, COUNT(DISTINCT lead_email) AS cnt
              FROM ${tLeads} ${where} ${col} IS NOT NULL AND TRIM(${col}) != ''
              GROUP BY ${col} ORDER BY cnt DESC LIMIT 25`
    }

    try {
      const [r1, r2, r3, r4] = await Promise.all([
        bqQuery(utmSqlFixed('utm_source'), leadsParams),
        bqQuery(utmSqlFixed('utm_campaign'), leadsParams),
        bqQuery(utmSqlFixed('utm_medium'), leadsParams),
        bqQuery(utmSqlFixed('utm_content'), leadsParams),
      ])
      const mapRows = (rows: typeof r1.rows) => rows.map(r => ({
        value: r.val ?? '',
        count: parseInt(r.cnt ?? '0'),
      }))
      return res.json({
        utmSource: mapRows(r1.rows),
        utmCampaign: mapRows(r2.rows),
        utmMedium: mapRows(r3.rows),
        utmContent: mapRows(r4.rows),
      })
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message })
    }
  }

  // ── Behavior before/after ────────────────────────────────────────────────
  if (type === 'behavior') {
    res.setHeader('Cache-Control', 'no-store')

    const summarySql = `
      WITH
        filtered AS (
          SELECT LOWER(TRIM(lead_email)) AS email, MIN(lead_register) AS data_entrada
          FROM ${tLeads} ${whereLeads}
          GROUP BY LOWER(TRIM(lead_email))
        ),
        purchases AS (
          SELECT LOWER(TRIM(E_mail_do_Comprador)) AS email,
            COALESCE(Data_de_Aprova____o, Data_do_Pedido) AS dt
          FROM ${tVendas} WHERE E_mail_do_Comprador IS NOT NULL
        ),
        behavior AS (
          SELECT
            f.email,
            COUNTIF(p.dt < f.data_entrada) AS antes,
            COUNTIF(p.dt >= f.data_entrada) AS depois
          FROM filtered f LEFT JOIN purchases p ON f.email = p.email
          GROUP BY f.email
        )
      SELECT
        COUNT(*) AS total,
        COUNTIF(antes > 0 AND depois = 0) AS so_antes,
        COUNTIF(antes = 0 AND depois > 0) AS so_depois,
        COUNTIF(antes > 0 AND depois > 0) AS ambos,
        COUNTIF(antes = 0 AND depois = 0) AS nenhum,
        ROUND(AVG(CAST(antes AS FLOAT64)), 2) AS media_antes,
        ROUND(AVG(CAST(depois AS FLOAT64)), 2) AS media_depois
      FROM behavior
    `

    const productsSql = `
      WITH
        filtered AS (
          SELECT LOWER(TRIM(lead_email)) AS email, MIN(lead_register) AS data_entrada
          FROM ${tLeads} ${whereLeads}
          GROUP BY LOWER(TRIM(lead_email))
        ),
        purchases AS (
          SELECT LOWER(TRIM(E_mail_do_Comprador)) AS email,
            COALESCE(Data_de_Aprova____o, Data_do_Pedido) AS dt,
            Nome_do_Produto AS produto
          FROM ${tVendas} WHERE E_mail_do_Comprador IS NOT NULL
        )
      SELECT
        produto,
        COUNTIF(p.dt < f.data_entrada) AS antes,
        COUNTIF(p.dt >= f.data_entrada) AS depois
      FROM filtered f INNER JOIN purchases p ON f.email = p.email
      WHERE p.dt IS NOT NULL
      GROUP BY produto
      ORDER BY (COUNTIF(p.dt < f.data_entrada) + COUNTIF(p.dt >= f.data_entrada)) DESC
      LIMIT 20
    `

    try {
      const [sumRes, prodRes] = await Promise.all([
        bqQuery(summarySql, leadsParams),
        bqQuery(productsSql, leadsParams),
      ])
      const s = sumRes.rows[0] ?? {}
      return res.json({
        total: parseInt(s.total ?? '0'),
        soAntes: parseInt(s.so_antes ?? '0'),
        soDepois: parseInt(s.so_depois ?? '0'),
        ambos: parseInt(s.ambos ?? '0'),
        nenhum: parseInt(s.nenhum ?? '0'),
        mediaAntes: parseFloat(s.media_antes ?? '0'),
        mediaDepois: parseFloat(s.media_depois ?? '0'),
        products: prodRes.rows.map(r => ({
          product: r.produto ?? '',
          antes: parseInt(r.antes ?? '0'),
          depois: parseInt(r.depois ?? '0'),
        })),
      })
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message })
    }
  }

  return res.status(400).json({ error: "type must be 'utm' or 'behavior'" })
}
