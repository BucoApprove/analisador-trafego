/**
 * Distribuição de vendas por UTM (source/campaign/medium/content) para um
 * produto do Placar, com atribuição any/last/origin — mesma lógica de
 * api/cross-analysis.ts (type='utm-attribution'), mas filtrando por
 * ID_do_Produto (via produtos_canonicos) em vez de Nome_do_Produto exato,
 * para funcionar com produtos fundidos (ex: "Renovação de acesso" = mais de
 * um product_id) e nomes que não batem 1:1 com o texto cru da Hotmart.
 *
 * any    = comprador teve essa UTM em algum momento do histórico
 * last   = última UTM registrada ATÉ a data da compra (não depois)
 * origin = primeira UTM do histórico do comprador
 *
 * GET /api/placar-vendas-utm?produto=...&since=YYYY-MM-DD&until=YYYY-MM-DD
 * Retorna { totalBuyers, bySource, byCampaign, byMedium, byContent }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { bqQuery, tableLeads, tableVendas, type QueryParam } from './_bq.js'
import { authUser, requireAdmin } from './_supabase-auth.js'
import { getProductIdsByNome } from './_produtos-db.js'

export interface UtmSalesAttribution { name: string; anyTime: number; lastBefore: number; origin: number }

function utmAttrSql(tVendas: string, tLeads: string, utmCol: string, produtoFilter: string, saleDateFilter: string): string {
  return `
    WITH
      buyers AS (
        SELECT
          LOWER(TRIM(E_mail_do_Comprador)) AS email,
          MIN(COALESCE(Data_de_Aprova____o, Data_do_Pedido)) AS data_compra
        FROM ${tVendas}
        WHERE Status IN ('APROVADO', 'COMPLETO') AND E_mail_do_Comprador IS NOT NULL
          AND ${produtoFilter}${saleDateFilter}
        GROUP BY LOWER(TRIM(E_mail_do_Comprador))
      ),
      buyer_leads_all AS (
        SELECT DISTINCT LOWER(TRIM(lead_email)) AS email
        FROM ${tLeads}
        WHERE lead_email IS NOT NULL
      ),
      -- ranking "origin" sobre o histórico completo (rn_first) e ranking
      -- "last" só sobre leads registrados ATÉ a compra — "última UTM antes
      -- da compra", não a última do histórico completo (que pode ser depois).
      leads_ranked AS (
        SELECT
          LOWER(TRIM(l.lead_email)) AS email,
          l.${utmCol} AS utm_raw,
          l.lead_register <= b.data_compra AS antes_compra,
          ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(l.lead_email)) ORDER BY l.lead_register ASC) AS rn_first,
          ROW_NUMBER() OVER (
            PARTITION BY LOWER(TRIM(l.lead_email)), (l.lead_register <= b.data_compra)
            ORDER BY l.lead_register DESC
          ) AS rn_last_before_purchase
        FROM ${tLeads} l
        INNER JOIN buyers b ON LOWER(TRIM(l.lead_email)) = b.email
        WHERE l.lead_email IS NOT NULL
          AND l.${utmCol} IS NOT NULL AND TRIM(l.${utmCol}) != ''
      ),
      buyer_utms AS (
        SELECT
          l.utm_raw,
          l.email,
          l.rn_first,
          (l.antes_compra AND l.rn_last_before_purchase = 1) AS is_last
        FROM leads_ranked l
      ),
      agg AS (
        SELECT
          utm_raw AS utm_val,
          COUNT(DISTINCT email)                                  AS any_time,
          COUNT(DISTINCT CASE WHEN is_last  THEN email END)      AS last_before,
          COUNT(DISTINCT CASE WHEN rn_first = 1 THEN email END)  AS origin
        FROM buyer_utms
        GROUP BY utm_raw
      ),
      buyers_no_utm AS (
        SELECT COUNT(DISTINCT b.email) AS cnt
        FROM buyers b
        INNER JOIN buyer_leads_all la ON b.email = la.email
        WHERE b.email NOT IN (SELECT DISTINCT email FROM leads_ranked)
      ),
      buyers_no_lead AS (
        SELECT COUNT(DISTINCT b.email) AS cnt
        FROM buyers b
        WHERE b.email NOT IN (SELECT DISTINCT email FROM buyer_leads_all)
      )
    SELECT ag.utm_val AS utm, ag.any_time, ag.last_before, ag.origin
    FROM agg ag
    UNION ALL
    SELECT '(sem campanha)', cnt, cnt, cnt FROM buyers_no_utm  WHERE cnt > 0
    UNION ALL
    SELECT '(sem UTM)',      cnt, cnt, cnt FROM buyers_no_lead WHERE cnt > 0
    ORDER BY any_time DESC
    LIMIT 100
  `
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await authUser(req, res); if (!user) return
  if (!requireAdmin(user, res)) return

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')

  const produto = typeof req.query.produto === 'string' ? req.query.produto : ''
  if (!produto) return res.status(400).json({ error: 'produto is required' })
  const since = typeof req.query.since === 'string' ? req.query.since : ''
  const until = typeof req.query.until === 'string' ? req.query.until : ''
  const saleDateFilter = since && until
    ? ` AND DATE(COALESCE(Data_de_Aprova____o, Data_do_Pedido)) BETWEEN @since AND @until`
    : ''
  const dateParams: QueryParam[] = since && until
    ? [{ name: 'since', value: since, type: 'DATE' }, { name: 'until', value: until, type: 'DATE' }]
    : []

  try {
    const productIds = await getProductIdsByNome(produto)
    if (productIds.length === 0) {
      return res.json({ totalBuyers: 0, bySource: [], byCampaign: [], byMedium: [], byContent: [] })
    }
    const produtoFilter = `CAST(ID_do_Produto AS INT64) IN (${productIds.join(', ')})`

    const tVendas = tableVendas()
    const tLeads = tableLeads()
    const params = dateParams

    const [sourceRes, campaignRes, mediumRes, contentRes, totalRes] = await Promise.all([
      bqQuery(utmAttrSql(tVendas, tLeads, 'utm_source',   produtoFilter, saleDateFilter), params),
      bqQuery(utmAttrSql(tVendas, tLeads, 'utm_campaign', produtoFilter, saleDateFilter), params),
      bqQuery(utmAttrSql(tVendas, tLeads, 'utm_medium',   produtoFilter, saleDateFilter), params),
      bqQuery(utmAttrSql(tVendas, tLeads, 'utm_content',  produtoFilter, saleDateFilter), params),
      bqQuery(`
        SELECT COUNT(DISTINCT LOWER(TRIM(E_mail_do_Comprador))) AS cnt
        FROM ${tVendas}
        WHERE Status IN ('APROVADO', 'COMPLETO') AND E_mail_do_Comprador IS NOT NULL
          AND ${produtoFilter}${saleDateFilter}
      `, params),
    ])

    const parseRows = (rows: typeof sourceRes.rows): UtmSalesAttribution[] => rows.map(r => ({
      name:       r.utm ?? '',
      anyTime:    parseInt(r.any_time    ?? '0'),
      lastBefore: parseInt(r.last_before ?? '0'),
      origin:     parseInt(r.origin      ?? '0'),
    }))

    res.json({
      totalBuyers: parseInt(totalRes.rows[0]?.cnt ?? '0'),
      bySource:   parseRows(sourceRes.rows),
      byCampaign: parseRows(campaignRes.rows),
      byMedium:   parseRows(mediumRes.rows),
      byContent:  parseRows(contentRes.rows),
    })
  } catch (err) {
    console.error('placar-vendas-utm error:', err)
    res.status(500).json({ error: 'Erro interno', detail: (err as Error).message })
  }
}
