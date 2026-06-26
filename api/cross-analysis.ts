/**
 * Análises cruzadas leads × vendas.
 *
 * POST /api/cross-analysis
 *   body: { type: 'all', product: string, statuses: string[] }
 *     → roda as 6 análises e retorna CrossAnalysisData
 *
 *   body: { type: 'behavior-tag', tag: string, statuses: string[] }
 *     → retorna BehaviorTagResult para a tag selecionada
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { QueryParam } from './_bq.js'
import { bqQuery, tableLeads, tableVendas } from './_bq.js'
import { authUser } from './_supabase-auth.js'

function statusSql(statuses: string[]): { sql: string; params: QueryParam[] } {
  if (statuses.length === 0) return { sql: '', params: [] }
  const names = statuses.map((_, i) => `@st_${i}`)
  return {
    sql: ` AND Status IN (${names.join(', ')})`,
    params: statuses.map((s, i) => ({ name: `st_${i}`, value: s })),
  }
}

const VALID_UTM_COLS = ['utm_content', 'utm_campaign', 'utm_medium'] as const

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!await authUser(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  res.setHeader('Cache-Control', 'no-store')

  const tLeads = tableLeads()
  const tVendas = tableVendas()
  const body = req.body as { type: string; product?: string; statuses?: string[]; tag?: string; since?: string; until?: string }
  const statuses: string[] = Array.isArray(body.statuses) ? body.statuses : []
  const stClause = statusSql(statuses)

  const since = body.since ?? ''
  const until = body.until ?? ''
  const dateFilter = since && until
    ? ` AND DATE(lead_register) BETWEEN @since AND @until`
    : ''
  const saleDateFilter = since && until
    ? ` AND DATE(COALESCE(Data_de_Aprova____o, Data_do_Pedido)) BETWEEN @since AND @until`
    : ''
  const dateParams: QueryParam[] = since && until
    ? [{ name: 'since', value: since, type: 'DATE' }, { name: 'until', value: until, type: 'DATE' }]
    : []

  // ── behavior-tag ────────────────────────────────────────────────────────
  if (body.type === 'behavior-tag') {
    const tag = body.tag ?? ''
    if (!tag) return res.status(400).json({ error: 'tag is required' })

    const summarySql = `
      WITH
        tag_dates AS (
          SELECT LOWER(TRIM(lead_email)) AS email, MIN(lead_register) AS data_tag
          FROM ${tLeads}
          WHERE tag_name = @tag AND lead_email IS NOT NULL${dateFilter}
          GROUP BY LOWER(TRIM(lead_email))
        ),
        purchases AS (
          SELECT LOWER(TRIM(E_mail_do_Comprador)) AS email,
            COALESCE(Data_de_Aprova____o, Data_do_Pedido) AS dt,
            Nome_do_Produto AS produto
          FROM ${tVendas}
          WHERE E_mail_do_Comprador IS NOT NULL ${stClause.sql}${saleDateFilter}
        ),
        behavior AS (
          SELECT
            t.email,
            COUNTIF(p.dt < t.data_tag) AS antes,
            COUNTIF(p.dt >= t.data_tag) AS depois
          FROM tag_dates t
          LEFT JOIN purchases p ON t.email = p.email
          GROUP BY t.email
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
        tag_dates AS (
          SELECT LOWER(TRIM(lead_email)) AS email, MIN(lead_register) AS data_tag
          FROM ${tLeads}
          WHERE tag_name = @tag AND lead_email IS NOT NULL${dateFilter}
          GROUP BY LOWER(TRIM(lead_email))
        ),
        purchases AS (
          SELECT LOWER(TRIM(E_mail_do_Comprador)) AS email,
            COALESCE(Data_de_Aprova____o, Data_do_Pedido) AS dt,
            Nome_do_Produto AS produto
          FROM ${tVendas}
          WHERE E_mail_do_Comprador IS NOT NULL ${stClause.sql}${saleDateFilter}
        )
      SELECT
        produto,
        COUNTIF(p.dt < t.data_tag) AS antes,
        COUNTIF(p.dt >= t.data_tag) AS depois
      FROM tag_dates t
      INNER JOIN purchases p ON t.email = p.email
      WHERE p.dt IS NOT NULL
      GROUP BY produto
      ORDER BY (COUNTIF(p.dt < t.data_tag) + COUNTIF(p.dt >= t.data_tag)) DESC
      LIMIT 20
    `
    const params: QueryParam[] = [{ name: 'tag', value: tag }, ...stClause.params, ...dateParams]

    try {
      const [sumRes, prodRes] = await Promise.all([
        bqQuery(summarySql, params),
        bqQuery(productsSql, params),
      ])
      const s = sumRes.rows[0] ?? {}
      return res.json({
        count: parseInt(s.total ?? '0'),
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

  // ── type = 'utm-attribution' ─────────────────────────────────────────────
  if (body.type === 'utm-attribution') {
    const product = body.product ?? ''
    if (!product) return res.status(400).json({ error: 'product is required' })

    // Se nenhum status foi passado, força APROVADO e COMPLETO como padrão
    const attrStatuses = statuses.length > 0 ? statuses : ['APROVADO', 'COMPLETO']
    const attrStClause = statusSql(attrStatuses)
    const params: QueryParam[] = [{ name: 'product', value: product }, ...attrStClause.params, ...dateParams]

    // For each UTM dimension: anyTime / lastBefore / origin attribution.
    // leads_ranked usa histórico completo (sem filtro de data) para atribuição correta
    // lead_counts usa filtro de período para mostrar leads captados no intervalo selecionado
    function utmAttrSql(utmCol: string): string {
      return `
        WITH
          buyers AS (
            SELECT DISTINCT LOWER(TRIM(E_mail_do_Comprador)) AS email
            FROM ${tVendas}
            WHERE Nome_do_Produto = @product ${attrStClause.sql} AND E_mail_do_Comprador IS NOT NULL${saleDateFilter}
          ),
          -- todos os leads históricos dos compradores (sem filtro de data)
          buyer_leads_all AS (
            SELECT DISTINCT LOWER(TRIM(lead_email)) AS email
            FROM ${tLeads}
            WHERE lead_email IS NOT NULL
          ),
          -- leads com UTM preenchido, rankeados por comprador (histórico completo — para atribuição)
          leads_ranked AS (
            SELECT
              LOWER(TRIM(lead_email)) AS email,
              ${utmCol} AS utm_raw,
              ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(lead_email)) ORDER BY lead_register ASC)  AS rn_first,
              ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(lead_email)) ORDER BY lead_register DESC) AS rn_last
            FROM ${tLeads}
            WHERE lead_email IS NOT NULL
              AND ${utmCol} IS NOT NULL AND TRIM(${utmCol}) != ''
          ),
          -- join com compradores para as 3 atribuições numa passagem só
          buyer_utms AS (
            SELECT
              l.utm_raw,
              l.email,
              l.rn_first,
              l.rn_last
            FROM leads_ranked l
            INNER JOIN buyers b ON l.email = b.email
          ),
          agg AS (
            SELECT
              utm_raw AS utm_val,
              COUNT(DISTINCT email)                              AS any_time,
              COUNT(DISTINCT CASE WHEN rn_last  = 1 THEN email END) AS last_before,
              COUNT(DISTINCT CASE WHEN rn_first = 1 THEN email END) AS origin
            FROM buyer_utms
            GROUP BY utm_raw
          ),
          -- contagem de leads captados NO PERÍODO por utm (não histórico)
          lead_counts AS (
            SELECT ${utmCol} AS utm_val, COUNT(DISTINCT lead_email) AS cnt
            FROM ${tLeads}
            WHERE lead_email IS NOT NULL
              AND ${utmCol} IS NOT NULL AND TRIM(${utmCol}) != ''
              ${since && until ? `AND DATE(lead_register) BETWEEN @since AND @until` : ''}
            GROUP BY ${utmCol}
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
        SELECT
          ag.utm_val                AS utm,
          IFNULL(lc.cnt, 0)         AS leads,
          ag.any_time,
          ag.last_before,
          ag.origin
        FROM agg ag
        LEFT JOIN lead_counts lc ON ag.utm_val = lc.utm_val
        UNION ALL
        SELECT '(sem campanha)', 0, cnt, cnt, cnt FROM buyers_no_utm  WHERE cnt > 0
        UNION ALL
        SELECT '(sem UTM)',      0, cnt, cnt, cnt FROM buyers_no_lead WHERE cnt > 0
        ORDER BY any_time DESC, leads DESC
        LIMIT 100
      `
    }

    const totalBuyersSql = `
      SELECT COUNT(DISTINCT LOWER(TRIM(E_mail_do_Comprador))) AS cnt
      FROM ${tVendas}
      WHERE Nome_do_Produto = @product ${attrStClause.sql} AND E_mail_do_Comprador IS NOT NULL${saleDateFilter}
    `

    // Última tag do comprador antes da data da compra
    const lastTagSql = `
      WITH
        sales AS (
          SELECT
            LOWER(TRIM(E_mail_do_Comprador)) AS email,
            MIN(COALESCE(Data_de_Aprova____o, Data_do_Pedido)) AS data_compra
          FROM ${tVendas}
          WHERE Nome_do_Produto = @product ${attrStClause.sql} AND E_mail_do_Comprador IS NOT NULL${saleDateFilter}
          GROUP BY LOWER(TRIM(E_mail_do_Comprador))
        ),
        leads_before AS (
          SELECT
            LOWER(TRIM(l.lead_email)) AS email,
            l.tag_name,
            l.lead_register,
            ROW_NUMBER() OVER (
              PARTITION BY LOWER(TRIM(l.lead_email))
              ORDER BY l.lead_register DESC
            ) AS rn
          FROM ${tLeads} l
          INNER JOIN sales s ON LOWER(TRIM(l.lead_email)) = s.email
          WHERE l.lead_email IS NOT NULL
            AND l.tag_name IS NOT NULL
            AND l.lead_register <= s.data_compra
        )
      SELECT
        IFNULL(tag_name, '(sem tag antes da compra)') AS last_tag,
        COUNT(DISTINCT email) AS compradores
      FROM leads_before
      WHERE rn = 1
      GROUP BY last_tag
      ORDER BY compradores DESC
      LIMIT 50
    `

    try {
      // Wave 1: 3 dimensões UTM (queries pesadas com window functions)
      const [contentRes, campaignRes, mediumRes] = await Promise.all([
        bqQuery(utmAttrSql('utm_content'),  params),
        bqQuery(utmAttrSql('utm_campaign'), params),
        bqQuery(utmAttrSql('utm_medium'),   params),
      ])
      // Wave 2: totais e last tag (mais leves)
      const [totalRes, lastTagRes] = await Promise.all([
        bqQuery(totalBuyersSql, params),
        bqQuery(lastTagSql, params),
      ])

      const parseRows = (rows: typeof contentRes.rows) => rows.map(r => ({
        utm:        r.utm ?? '',
        leads:      parseInt(r.leads     ?? '0'),
        anyTime:    parseInt(r.any_time  ?? '0'),
        lastBefore: parseInt(r.last_before ?? '0'),
        origin:     parseInt(r.origin    ?? '0'),
      }))

      return res.json({
        totalBuyers: parseInt(totalRes.rows[0]?.cnt ?? '0'),
        byContent:   parseRows(contentRes.rows),
        byCampaign:  parseRows(campaignRes.rows),
        byMedium:    parseRows(mediumRes.rows),
        lastTagDist: lastTagRes.rows.map(r => ({
          tag:         r.last_tag ?? '',
          compradores: parseInt(r.compradores ?? '0'),
        })),
      })
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message })
    }
  }

  // ── type = 'funnel-overview' ─────────────────────────────────────────────
  if (body.type === 'funnel-overview') {
    if (!since || !until) return res.status(400).json({ error: 'since and until are required' })

    function overviewUtmAttrSql(utmCol: string): string {
      return `
        WITH
          buyers AS (
            SELECT DISTINCT LOWER(TRIM(E_mail_do_Comprador)) AS email
            FROM ${tVendas}
            WHERE E_mail_do_Comprador IS NOT NULL ${stClause.sql}${saleDateFilter}
          ),
          buyer_leads_all AS (
            SELECT DISTINCT LOWER(TRIM(lead_email)) AS email
            FROM ${tLeads}
            WHERE lead_email IS NOT NULL
          ),
          leads_ranked AS (
            SELECT
              LOWER(TRIM(lead_email)) AS email,
              ${utmCol} AS utm_raw,
              ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(lead_email)) ORDER BY lead_register ASC)  AS rn_first,
              ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(lead_email)) ORDER BY lead_register DESC) AS rn_last
            FROM ${tLeads}
            WHERE lead_email IS NOT NULL
              AND ${utmCol} IS NOT NULL AND TRIM(${utmCol}) != ''
          ),
          buyer_utms AS (
            SELECT l.utm_raw, l.email, l.rn_first, l.rn_last
            FROM leads_ranked l
            INNER JOIN buyers b ON l.email = b.email
          ),
          agg AS (
            SELECT
              utm_raw AS utm_val,
              COUNT(DISTINCT email)                                   AS any_time,
              COUNT(DISTINCT CASE WHEN rn_last  = 1 THEN email END)  AS last_before,
              COUNT(DISTINCT CASE WHEN rn_first = 1 THEN email END)  AS origin
            FROM buyer_utms
            GROUP BY utm_raw
          )
        SELECT utm_val AS name, any_time, last_before, origin
        FROM agg
        ORDER BY any_time DESC
        LIMIT 100
      `
    }

    function leadsInPeriodSql(utmCol: string): string {
      return `
        SELECT ${utmCol} AS name, COUNT(DISTINCT lead_email) AS leads
        FROM ${tLeads}
        WHERE lead_email IS NOT NULL
          AND ${utmCol} IS NOT NULL AND TRIM(${utmCol}) != ''
          AND DATE(lead_register) BETWEEN @since AND @until
        GROUP BY ${utmCol}
        ORDER BY leads DESC
        LIMIT 100
      `
    }

    const totalBuyersSql = `
      SELECT COUNT(DISTINCT LOWER(TRIM(E_mail_do_Comprador))) AS cnt
      FROM ${tVendas}
      WHERE E_mail_do_Comprador IS NOT NULL ${stClause.sql}${saleDateFilter}
    `

    const productCoverageSql = `
      WITH
        all_buyers AS (
          SELECT Nome_do_Produto AS produto, LOWER(TRIM(E_mail_do_Comprador)) AS email
          FROM ${tVendas}
          WHERE Status IN ('APROVADO','COMPLETO') AND E_mail_do_Comprador IS NOT NULL${saleDateFilter}
        ),
        lead_emails AS (
          SELECT DISTINCT LOWER(TRIM(lead_email)) AS email FROM ${tLeads} WHERE lead_email IS NOT NULL
        )
      SELECT
        produto,
        COUNT(DISTINCT email)                                                             AS total_vendas,
        COUNT(DISTINCT CASE WHEN email IN (SELECT email FROM lead_emails) THEN email END) AS com_lead,
        COUNT(DISTINCT CASE WHEN email NOT IN (SELECT email FROM lead_emails) THEN email END) AS sem_lead
      FROM all_buyers
      GROUP BY produto
      ORDER BY total_vendas DESC
    `

    try {
      // Wave 1 — UTM attribution (4 dimensões)
      const [sourceAttr, campaignAttr, mediumAttr, contentAttr] = await Promise.all([
        bqQuery(overviewUtmAttrSql('utm_source'),   [...stClause.params, ...dateParams]),
        bqQuery(overviewUtmAttrSql('utm_campaign'), [...stClause.params, ...dateParams]),
        bqQuery(overviewUtmAttrSql('utm_medium'),   [...stClause.params, ...dateParams]),
        bqQuery(overviewUtmAttrSql('utm_content'),  [...stClause.params, ...dateParams]),
      ])
      // Wave 2 — leads no período + cobertura por produto + total compradores
      const [srcLeads, campLeads, medLeads, contLeads, totalRes, productRes] = await Promise.all([
        bqQuery(leadsInPeriodSql('utm_source'),   dateParams),
        bqQuery(leadsInPeriodSql('utm_campaign'), dateParams),
        bqQuery(leadsInPeriodSql('utm_medium'),   dateParams),
        bqQuery(leadsInPeriodSql('utm_content'),  dateParams),
        bqQuery(totalBuyersSql, [...stClause.params, ...dateParams]),
        bqQuery(productCoverageSql, dateParams),
      ])

      const parseAttr = (rows: typeof sourceAttr.rows) => rows.map(r => ({
        name:       r.name ?? '',
        anyTime:    parseInt(r.any_time    ?? '0'),
        lastBefore: parseInt(r.last_before ?? '0'),
        origin:     parseInt(r.origin      ?? '0'),
      }))
      const parseLeads = (rows: typeof srcLeads.rows) => rows.map(r => ({
        name:  r.name  ?? '',
        leads: parseInt(r.leads ?? '0'),
      }))

      return res.json({
        totalBuyers:     parseInt(totalRes.rows[0]?.cnt ?? '0'),
        bySource:        parseAttr(sourceAttr.rows),
        byCampaign:      parseAttr(campaignAttr.rows),
        byMedium:        parseAttr(mediumAttr.rows),
        byContent:       parseAttr(contentAttr.rows),
        leadsBySource:   parseLeads(srcLeads.rows),
        leadsByCampaign: parseLeads(campLeads.rows),
        leadsByMedium:   parseLeads(medLeads.rows),
        leadsByContent:  parseLeads(contLeads.rows),
        byProduct: productRes.rows.map(r => ({
          produto:       r.produto ?? '',
          totalVendas:   parseInt(r.total_vendas ?? '0'),
          vendasComLead: parseInt(r.com_lead     ?? '0'),
          vendasSemLead: parseInt(r.sem_lead     ?? '0'),
        })),
      })
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message })
    }
  }

  // ── type = 'linked-products' ─────────────────────────────────────────────
  if (body.type === 'linked-products') {
    const product = body.product ?? ''
    if (!product) return res.status(400).json({ error: 'product is required' })

    const params: QueryParam[] = [{ name: 'product', value: product }, ...stClause.params, ...dateParams]

    // Compradores do produto referência, com a data da primeira compra desse produto
    const targetBuyersSql = `
      SELECT LOWER(TRIM(E_mail_do_Comprador)) AS email,
        MIN(COALESCE(Data_de_Aprova____o, Data_do_Pedido)) AS data_b
      FROM ${tVendas}
      WHERE Nome_do_Produto = @product ${stClause.sql} AND E_mail_do_Comprador IS NOT NULL${saleDateFilter}
      GROUP BY LOWER(TRIM(E_mail_do_Comprador))
    `

    // Produtos comprados ANTES do produto referência (qualquer produto que precedeu)
    const beforeSql = `
      WITH
        target_buyers AS (${targetBuyersSql}),
        other_sales AS (
          SELECT LOWER(TRIM(E_mail_do_Comprador)) AS email, Nome_do_Produto AS produto,
            MIN(COALESCE(Data_de_Aprova____o, Data_do_Pedido)) AS data_compra
          FROM ${tVendas}
          WHERE Nome_do_Produto != @product AND E_mail_do_Comprador IS NOT NULL${saleDateFilter}
          GROUP BY LOWER(TRIM(E_mail_do_Comprador)), Nome_do_Produto
        )
      SELECT
        o.produto,
        COUNT(DISTINCT o.email) AS compradores
      FROM other_sales o
      INNER JOIN target_buyers t ON o.email = t.email
      WHERE o.data_compra < t.data_b
      GROUP BY o.produto
      ORDER BY compradores DESC
      LIMIT 30
    `

    // Primeiro produto já comprado por cada comprador (origem) — entre quem também comprou o produto referência
    const originSql = `
      WITH
        target_buyers AS (${targetBuyersSql}),
        all_sales AS (
          SELECT LOWER(TRIM(E_mail_do_Comprador)) AS email, Nome_do_Produto AS produto,
            MIN(COALESCE(Data_de_Aprova____o, Data_do_Pedido)) AS data_compra
          FROM ${tVendas}
          WHERE E_mail_do_Comprador IS NOT NULL${saleDateFilter}
          GROUP BY LOWER(TRIM(E_mail_do_Comprador)), Nome_do_Produto
        ),
        ranked AS (
          SELECT email, produto, data_compra,
            ROW_NUMBER() OVER (PARTITION BY email ORDER BY data_compra ASC) AS rn
          FROM all_sales
        )
      SELECT r.produto, COUNT(DISTINCT r.email) AS compradores
      FROM ranked r
      INNER JOIN target_buyers t ON r.email = t.email
      WHERE r.rn = 1
      GROUP BY r.produto
      ORDER BY compradores DESC
      LIMIT 30
    `

    const totalBuyersSql = `
      SELECT COUNT(DISTINCT LOWER(TRIM(E_mail_do_Comprador))) AS cnt
      FROM ${tVendas}
      WHERE Nome_do_Produto = @product ${stClause.sql} AND E_mail_do_Comprador IS NOT NULL${saleDateFilter}
    `

    try {
      const [beforeRes, originRes, totalRes] = await Promise.all([
        bqQuery(beforeSql, params),
        bqQuery(originSql, params),
        bqQuery(totalBuyersSql, params),
      ])

      const totalBuyers = parseInt(totalRes.rows[0]?.cnt ?? '0')
      return res.json({
        totalBuyers,
        before: beforeRes.rows.map(r => ({
          produto: r.produto ?? '',
          compradores: parseInt(r.compradores ?? '0'),
        })),
        origin: originRes.rows.map(r => ({
          produto: r.produto ?? '',
          compradores: parseInt(r.compradores ?? '0'),
        })),
      })
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message })
    }
  }

  // ── type = 'all' ─────────────────────────────────────────────────────────
  if (body.type !== 'all') return res.status(400).json({ error: "type must be 'all', 'behavior-tag', 'utm-attribution', 'funnel-overview', or 'linked-products'" })
  const product = body.product ?? ''
  if (!product) return res.status(400).json({ error: 'product is required' })

  const baseParams: QueryParam[] = [{ name: 'product', value: product }, ...stClause.params, ...dateParams]

  // ── A1: Lead→Compra por produto ─────────────────────────────────────────
  const ltcSql = `
    WITH
      first_lead AS (
        SELECT LOWER(TRIM(lead_email)) AS email, MIN(lead_register) AS data_lead,
          ANY_VALUE(lead_name) AS lead_name
        FROM ${tLeads} WHERE lead_email IS NOT NULL${dateFilter}
        GROUP BY LOWER(TRIM(lead_email))
      ),
      first_sale AS (
        SELECT LOWER(TRIM(E_mail_do_Comprador)) AS email,
          MIN(COALESCE(Data_de_Aprova____o, Data_do_Pedido)) AS data_compra
        FROM ${tVendas}
        WHERE Nome_do_Produto = @product ${stClause.sql} AND E_mail_do_Comprador IS NOT NULL${saleDateFilter}
        GROUP BY LOWER(TRIM(E_mail_do_Comprador))
      )
    SELECT
      IFNULL(l.lead_name, s.email) AS nome, s.email,
      CAST(l.data_lead AS STRING) AS data_lead,
      CAST(s.data_compra AS STRING) AS data_compra,
      DATE_DIFF(CAST(s.data_compra AS DATE), CAST(l.data_lead AS DATE), DAY) AS dias
    FROM first_sale s
    INNER JOIN first_lead l ON s.email = l.email
    WHERE DATE_DIFF(CAST(s.data_compra AS DATE), CAST(l.data_lead AS DATE), DAY) >= 0
    ORDER BY dias
    LIMIT 2000
  `

  // ── A1b: Lead→Compra todos os produtos ───────────────────────────────────
  const ltcAllSql = `
    WITH
      first_lead AS (
        SELECT LOWER(TRIM(lead_email)) AS email, MIN(lead_register) AS data_lead
        FROM ${tLeads} WHERE lead_email IS NOT NULL${dateFilter}
        GROUP BY LOWER(TRIM(lead_email))
      ),
      sales AS (
        SELECT LOWER(TRIM(E_mail_do_Comprador)) AS email, Nome_do_Produto AS produto,
          MIN(COALESCE(Data_de_Aprova____o, Data_do_Pedido)) AS data_compra
        FROM ${tVendas}
        WHERE E_mail_do_Comprador IS NOT NULL ${stClause.sql}${saleDateFilter}
        GROUP BY LOWER(TRIM(E_mail_do_Comprador)), Nome_do_Produto
      ),
      joined AS (
        SELECT s.produto, DATE_DIFF(CAST(s.data_compra AS DATE), CAST(l.data_lead AS DATE), DAY) AS dias
        FROM sales s INNER JOIN first_lead l ON s.email = l.email
        WHERE DATE_DIFF(CAST(s.data_compra AS DATE), CAST(l.data_lead AS DATE), DAY) >= 0
      )
    SELECT
      produto,
      COUNT(*) AS leads_que_compraram,
      CAST(APPROX_QUANTILES(dias, 2)[OFFSET(1)] AS INT64) AS mediana,
      MIN(dias) AS minimo, MAX(dias) AS maximo,
      ROUND(AVG(CAST(dias AS FLOAT64)), 1) AS media
    FROM joined
    GROUP BY produto ORDER BY mediana
  `
  const stOnlyParams = [...stClause.params, ...dateParams]

  // ── A2: Tags por comprador ───────────────────────────────────────────────
  const tagsSql = `
    WITH
      buyers AS (
        SELECT DISTINCT LOWER(TRIM(E_mail_do_Comprador)) AS email
        FROM ${tVendas}
        WHERE Nome_do_Produto = @product ${stClause.sql} AND E_mail_do_Comprador IS NOT NULL${saleDateFilter}
      ),
      buyer_tag_counts AS (
        SELECT LOWER(TRIM(lead_email)) AS email, COUNT(DISTINCT tag_name) AS num_tags
        FROM ${tLeads}
        WHERE tag_name IS NOT NULL${dateFilter} AND LOWER(TRIM(lead_email)) IN (SELECT email FROM buyers)
        GROUP BY LOWER(TRIM(lead_email))
      )
    SELECT
      COUNT(*) AS cnt,
      ROUND(AVG(CAST(num_tags AS FLOAT64)), 2) AS media,
      CAST(APPROX_QUANTILES(num_tags, 2)[OFFSET(1)] AS INT64) AS mediana,
      MAX(num_tags) AS max_tags,
      COUNTIF(num_tags = 1) AS d1, COUNTIF(num_tags = 2) AS d2,
      COUNTIF(num_tags = 3) AS d3, COUNTIF(num_tags = 4) AS d4,
      COUNTIF(num_tags = 5) AS d5, COUNTIF(num_tags >= 6) AS d6plus
    FROM buyer_tag_counts
  `

  // ── A3: utm_content ranking ──────────────────────────────────────────────
  const utmContentSql = `
    SELECT utm_content AS val, COUNT(DISTINCT lead_email) AS cnt
    FROM ${tLeads}
    WHERE utm_content IS NOT NULL AND TRIM(utm_content) != ''${dateFilter}
    GROUP BY utm_content ORDER BY cnt DESC LIMIT 50
  `

  // ── A4: Primeira entrada → vendas (por tag e por form) ───────────────────
  const firstEntrySql = `
    WITH
      buyers AS (
        SELECT DISTINCT LOWER(TRIM(E_mail_do_Comprador)) AS email
        FROM ${tVendas}
        WHERE Nome_do_Produto = @product ${stClause.sql} AND E_mail_do_Comprador IS NOT NULL${saleDateFilter}
      ),
      leads_rn AS (
        SELECT
          LOWER(TRIM(lead_email)) AS email,
          tag_name, CAST(lead_register_form AS STRING) AS form,
          ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(lead_email)) ORDER BY lead_register) AS rn
        FROM ${tLeads} WHERE lead_email IS NOT NULL${dateFilter}
      ),
      first_entry AS (
        SELECT l.email, l.tag_name AS first_tag, l.form AS first_form
        FROM leads_rn l INNER JOIN buyers b ON l.email = b.email WHERE l.rn = 1
      )
    SELECT first_tag AS category, 'tag' AS tipo, COUNT(*) AS compradores
    FROM first_entry WHERE first_tag IS NOT NULL GROUP BY first_tag
    UNION ALL
    SELECT first_form, 'form', COUNT(*) AS compradores
    FROM first_entry WHERE first_form IS NOT NULL GROUP BY first_form
    ORDER BY compradores DESC
  `

  // ── A5: Funil por UTM (3 dimensões) ─────────────────────────────────────
  function utmFunnelSql(utmCol: string): string {
    return `
      WITH
        first_utm AS (
          SELECT LOWER(TRIM(lead_email)) AS email, ${utmCol} AS utm_val,
            ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(lead_email)) ORDER BY lead_register) AS rn
          FROM ${tLeads} WHERE lead_email IS NOT NULL AND ${utmCol} IS NOT NULL AND TRIM(${utmCol}) != ''${dateFilter}
        ),
        first_entries AS (SELECT email, utm_val FROM first_utm WHERE rn = 1),
        buyers AS (
          SELECT DISTINCT LOWER(TRIM(E_mail_do_Comprador)) AS email
          FROM ${tVendas}
          WHERE Nome_do_Produto = @product ${stClause.sql} AND E_mail_do_Comprador IS NOT NULL${saleDateFilter}
        )
      SELECT
        fe.utm_val AS utm,
        COUNT(DISTINCT fe.email) AS leads,
        COUNT(DISTINCT b.email) AS compradores,
        ROUND(100.0 * COUNT(DISTINCT b.email) / NULLIF(COUNT(DISTINCT fe.email), 0), 1) AS taxa
      FROM first_entries fe LEFT JOIN buyers b ON fe.email = b.email
      GROUP BY fe.utm_val ORDER BY leads DESC LIMIT 50
    `
  }

  // ── A6: Tags dos compradores ─────────────────────────────────────────────
  const buyerTagsSql = `
    WITH
      buyers AS (
        SELECT DISTINCT LOWER(TRIM(E_mail_do_Comprador)) AS email
        FROM ${tVendas}
        WHERE Nome_do_Produto = @product ${stClause.sql} AND E_mail_do_Comprador IS NOT NULL${saleDateFilter}
      ),
      buyer_count AS (
        SELECT COUNT(*) AS total FROM buyers b
        INNER JOIN (SELECT DISTINCT LOWER(TRIM(lead_email)) AS email FROM ${tLeads} WHERE lead_email IS NOT NULL${dateFilter}) l ON b.email = l.email
      )
    SELECT
      l.tag_name AS tag,
      COUNT(DISTINCT LOWER(TRIM(l.lead_email))) AS compradores,
      ROUND(100.0 * COUNT(DISTINCT LOWER(TRIM(l.lead_email))) / (SELECT total FROM buyer_count), 1) AS pct
    FROM ${tLeads} l INNER JOIN buyers b ON LOWER(TRIM(l.lead_email)) = b.email
    WHERE l.tag_name IS NOT NULL${dateFilter}
    GROUP BY l.tag_name ORDER BY compradores DESC LIMIT 50
  `

  // ── Available tags & products ────────────────────────────────────────────
  const availTagsSql = `SELECT DISTINCT tag_name AS t FROM ${tLeads} WHERE tag_name IS NOT NULL${dateFilter} ORDER BY t LIMIT 200`

  try {
    // Wave 1: queries filtradas por produto (rápidas)
    const [ltcRes, tagsRes, firstEntryRes, buyerTagsRes, availTagsRes] = await Promise.all([
      bqQuery(ltcSql, baseParams),
      bqQuery(tagsSql, baseParams),
      bqQuery(firstEntrySql, baseParams),
      bqQuery(buyerTagsSql, baseParams),
      bqQuery(availTagsSql, dateParams),
    ])

    // Wave 2: queries full-scan (mais pesadas, separadas para não disputar timeout)
    const [ltcAllRes, utmCRes, utmF_content, utmF_campaign, utmF_medium] = await Promise.all([
      bqQuery(ltcAllSql, stOnlyParams),
      bqQuery(utmContentSql, dateParams),
      bqQuery(utmFunnelSql('utm_content'), baseParams),
      bqQuery(utmFunnelSql('utm_campaign'), baseParams),
      bqQuery(utmFunnelSql('utm_medium'), baseParams),
    ])


    // Parse A1
    const ltcRows = ltcRes.rows
    const ltcDias = ltcRows.map(r => parseInt(r.dias ?? '0')).filter(d => !isNaN(d))
    const ltcMediana = ltcDias.length > 0
      ? ltcDias.sort((a, b) => a - b)[Math.floor(ltcDias.length / 2)]
      : null
    const leadToCompra = {
      count: ltcRows.length,
      media: ltcRows.length > 0 ? Math.round(ltcDias.reduce((a, b) => a + b, 0) / ltcDias.length * 10) / 10 : null,
      mediana: ltcMediana,
      min: ltcDias.length > 0 ? Math.min(...ltcDias) : null,
      max: ltcDias.length > 0 ? Math.max(...ltcDias) : null,
      rows: ltcRows.map(r => ({
        nome: r.nome ?? '', email: r.email ?? '',
        dataLead: r.data_lead ?? '', dataCompra: r.data_compra ?? '',
        dias: parseInt(r.dias ?? '0'),
      })),
    }

    // Parse A1b
    const allProductsLTC = ltcAllRes.rows.map(r => ({
      produto: r.produto ?? '',
      leadsQueCompraram: parseInt(r.leads_que_compraram ?? '0'),
      mediana: parseInt(r.mediana ?? '0'),
      minimo: parseInt(r.minimo ?? '0'),
      maximo: parseInt(r.maximo ?? '0'),
      media: parseFloat(r.media ?? '0'),
    }))

    // Parse A2
    const tRow = tagsRes.rows[0] ?? {}
    const distribution = [1, 2, 3, 4, 5, 6].map((n, i) => ({
      tags: n === 6 ? 99 : n,
      label: n === 6 ? '6+' : String(n),
      count: parseInt(tRow[`d${n === 6 ? '6plus' : n}`] ?? '0'),
    }))
    const avgTags = {
      count: parseInt(tRow.cnt ?? '0'),
      media: parseFloat(tRow.media ?? '0'),
      mediana: parseInt(tRow.mediana ?? '0'),
      max: parseInt(tRow.max_tags ?? '0'),
      distribution: distribution.map(d => ({ tags: d.tags, count: d.count, label: d.label })),
    }

    // Parse A3
    const utmContent = utmCRes.rows.map(r => ({
      utmContent: r.val ?? '',
      leadsUnicos: parseInt(r.cnt ?? '0'),
    }))

    // Parse A4
    const byTag = firstEntryRes.rows
      .filter(r => r.tipo === 'tag')
      .map(r => ({ category: r.category ?? '', compradores: parseInt(r.compradores ?? '0') }))
    const byForm = firstEntryRes.rows
      .filter(r => r.tipo === 'form')
      .map(r => ({ category: r.category ?? '', compradores: parseInt(r.compradores ?? '0') }))
    const firstEntry = { byTag, byForm }

    // Parse A5
    const mapFunnel = (rows: typeof utmF_content.rows) => rows.map(r => ({
      utm: r.utm ?? '',
      leads: parseInt(r.leads ?? '0'),
      compradores: parseInt(r.compradores ?? '0'),
      taxaConversao: parseFloat(r.taxa ?? '0'),
    }))
    const utmFunnel = {
      utm_content: mapFunnel(utmF_content.rows),
      utm_campaign: mapFunnel(utmF_campaign.rows),
      utm_medium: mapFunnel(utmF_medium.rows),
    }

    // Parse A6
    const buyerTags = buyerTagsRes.rows.map(r => ({
      tag: r.tag ?? '',
      compradores: parseInt(r.compradores ?? '0'),
      pct: parseFloat(r.pct ?? '0'),
    }))

    res.json({
      leadToCompra,
      allProductsLTC,
      avgTags,
      utmContent,
      firstEntry,
      utmFunnel,
      buyerTags,
      availableTags: availTagsRes.rows.map(r => r.t ?? '').filter(Boolean),
      availableProducts: [],
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
}
