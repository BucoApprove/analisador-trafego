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

    const params: QueryParam[] = [{ name: 'product', value: product }, ...stClause.params, ...dateParams]

    // For each UTM dimension: anyTime / lastBefore / origin attribution.
    // Rows: known UTMs + "(sem campanha)" (has lead but no UTM) + "(sem UTM)" (no lead at all)
    function utmAttrSql(utmCol: string): string {
      return `
        WITH
          buyers AS (
            SELECT DISTINCT LOWER(TRIM(E_mail_do_Comprador)) AS email
            FROM ${tVendas}
            WHERE Nome_do_Produto = @product ${stClause.sql} AND E_mail_do_Comprador IS NOT NULL${saleDateFilter}
          ),
          -- todos os leads dos compradores (sem filtro de utm para incluir nulls)
          buyer_leads_all AS (
            SELECT LOWER(TRIM(lead_email)) AS email
            FROM ${tLeads}
            WHERE lead_email IS NOT NULL${dateFilter}
          ),
          -- leads rankeados por email com utm preenchido
          leads_ranked AS (
            SELECT
              LOWER(TRIM(lead_email)) AS email,
              ${utmCol} AS utm_raw,
              lead_register,
              ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(lead_email)) ORDER BY lead_register ASC)  AS rn_first,
              ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(lead_email)) ORDER BY lead_register DESC) AS rn_last
            FROM ${tLeads}
            WHERE lead_email IS NOT NULL
              AND ${utmCol} IS NOT NULL AND TRIM(${utmCol}) != ''${dateFilter}
          ),
          any_touch AS (
            SELECT utm_raw AS utm_val, COUNT(DISTINCT l.email) AS cnt
            FROM leads_ranked l INNER JOIN buyers b ON l.email = b.email
            GROUP BY utm_raw
          ),
          last_touch AS (
            SELECT utm_raw AS utm_val, COUNT(DISTINCT l.email) AS cnt
            FROM leads_ranked l INNER JOIN buyers b ON l.email = b.email
            WHERE rn_last = 1
            GROUP BY utm_raw
          ),
          origin_touch AS (
            SELECT utm_raw AS utm_val, COUNT(DISTINCT l.email) AS cnt
            FROM leads_ranked l INNER JOIN buyers b ON l.email = b.email
            WHERE rn_first = 1
            GROUP BY utm_raw
          ),
          all_utms AS (
            SELECT DISTINCT ${utmCol} AS utm_val
            FROM ${tLeads}
            WHERE lead_email IS NOT NULL
              AND ${utmCol} IS NOT NULL AND TRIM(${utmCol}) != ''${dateFilter}
          ),
          lead_counts AS (
            SELECT ${utmCol} AS utm_val, COUNT(DISTINCT lead_email) AS cnt
            FROM ${tLeads}
            WHERE lead_email IS NOT NULL
              AND ${utmCol} IS NOT NULL AND TRIM(${utmCol}) != ''${dateFilter}
            GROUP BY ${utmCol}
          ),
          -- compradores com lead mas sem este UTM específico preenchido
          buyers_no_utm AS (
            SELECT COUNT(DISTINCT b.email) AS cnt
            FROM buyers b
            INNER JOIN buyer_leads_all la ON b.email = la.email
            WHERE b.email NOT IN (SELECT DISTINCT email FROM leads_ranked)
          ),
          -- compradores sem nenhum registro na tabela de leads
          buyers_no_lead AS (
            SELECT COUNT(DISTINCT b.email) AS cnt
            FROM buyers b
            WHERE b.email NOT IN (SELECT DISTINCT email FROM buyer_leads_all)
          )
        SELECT
          au.utm_val AS utm,
          IFNULL(lc.cnt, 0) AS leads,
          IFNULL(at2.cnt, 0) AS any_time,
          IFNULL(lt.cnt, 0)  AS last_before,
          IFNULL(ot.cnt, 0)  AS origin
        FROM all_utms au
        LEFT JOIN lead_counts  lc  ON au.utm_val = lc.utm_val
        LEFT JOIN any_touch    at2 ON au.utm_val = at2.utm_val
        LEFT JOIN last_touch   lt  ON au.utm_val = lt.utm_val
        LEFT JOIN origin_touch ot  ON au.utm_val = ot.utm_val
        UNION ALL
        SELECT '(sem campanha)' AS utm, 0 AS leads, cnt AS any_time, cnt AS last_before, cnt AS origin
        FROM buyers_no_utm WHERE cnt > 0
        UNION ALL
        SELECT '(sem UTM)' AS utm, 0 AS leads, cnt AS any_time, cnt AS last_before, cnt AS origin
        FROM buyers_no_lead WHERE cnt > 0
        ORDER BY leads DESC, any_time DESC
        LIMIT 100
      `
    }

    const totalBuyersSql = `
      SELECT COUNT(DISTINCT LOWER(TRIM(E_mail_do_Comprador))) AS cnt
      FROM ${tVendas}
      WHERE Nome_do_Produto = @product ${stClause.sql} AND E_mail_do_Comprador IS NOT NULL${saleDateFilter}
    `

    try {
      const [contentRes, campaignRes, mediumRes, totalRes] = await Promise.all([
        bqQuery(utmAttrSql('utm_content'),  params),
        bqQuery(utmAttrSql('utm_campaign'), params),
        bqQuery(utmAttrSql('utm_medium'),   params),
        bqQuery(totalBuyersSql, params),
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
      })
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message })
    }
  }

  // ── type = 'all' ─────────────────────────────────────────────────────────
  if (body.type !== 'all') return res.status(400).json({ error: "type must be 'all' or 'behavior-tag'" })
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
