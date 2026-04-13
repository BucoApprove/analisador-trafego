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

function auth(req: VercelRequest, res: VercelResponse): boolean {
  const header = req.headers.authorization ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  const ok =
    (provided && provided === process.env.DASHBOARD_TOKEN_ADMIN) ||
    (provided && provided === process.env.DASHBOARD_TOKEN)
  if (!ok) { res.status(401).json({ error: 'Unauthorized' }); return false }
  return true
}

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
  if (!auth(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  res.setHeader('Cache-Control', 'no-store')

  const tLeads = tableLeads()
  const tVendas = tableVendas()
  const body = req.body as { type: string; product?: string; statuses?: string[]; tag?: string }
  const statuses: string[] = Array.isArray(body.statuses) ? body.statuses : []
  const stClause = statusSql(statuses)

  // ── behavior-tag ────────────────────────────────────────────────────────
  if (body.type === 'behavior-tag') {
    const tag = body.tag ?? ''
    if (!tag) return res.status(400).json({ error: 'tag is required' })

    const summarySql = `
      WITH
        tag_dates AS (
          SELECT LOWER(TRIM(lead_email)) AS email, MIN(lead_register) AS data_tag
          FROM ${tLeads}
          WHERE tag_name = @tag AND lead_email IS NOT NULL
          GROUP BY LOWER(TRIM(lead_email))
        ),
        purchases AS (
          SELECT LOWER(TRIM(E_mail_do_Comprador)) AS email,
            COALESCE(Data_de_Aprova____o, Data_do_Pedido) AS dt,
            Nome_do_Produto AS produto
          FROM ${tVendas}
          WHERE E_mail_do_Comprador IS NOT NULL ${stClause.sql}
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
          WHERE tag_name = @tag AND lead_email IS NOT NULL
          GROUP BY LOWER(TRIM(lead_email))
        ),
        purchases AS (
          SELECT LOWER(TRIM(E_mail_do_Comprador)) AS email,
            COALESCE(Data_de_Aprova____o, Data_do_Pedido) AS dt,
            Nome_do_Produto AS produto
          FROM ${tVendas}
          WHERE E_mail_do_Comprador IS NOT NULL ${stClause.sql}
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
    const params: QueryParam[] = [{ name: 'tag', value: tag }, ...stClause.params]

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

  // ── type = 'all' ─────────────────────────────────────────────────────────
  if (body.type !== 'all') return res.status(400).json({ error: "type must be 'all' or 'behavior-tag'" })
  const product = body.product ?? ''
  if (!product) return res.status(400).json({ error: 'product is required' })

  const baseParams: QueryParam[] = [{ name: 'product', value: product }, ...stClause.params]

  // ── A1: Lead→Compra por produto ─────────────────────────────────────────
  const ltcSql = `
    WITH
      first_lead AS (
        SELECT LOWER(TRIM(lead_email)) AS email, MIN(lead_register) AS data_lead,
          ANY_VALUE(lead_name) AS lead_name
        FROM ${tLeads} WHERE lead_email IS NOT NULL
        GROUP BY LOWER(TRIM(lead_email))
      ),
      first_sale AS (
        SELECT LOWER(TRIM(E_mail_do_Comprador)) AS email,
          MIN(COALESCE(Data_de_Aprova____o, Data_do_Pedido)) AS data_compra
        FROM ${tVendas}
        WHERE Nome_do_Produto = @product ${stClause.sql} AND E_mail_do_Comprador IS NOT NULL
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
        FROM ${tLeads} WHERE lead_email IS NOT NULL
        GROUP BY LOWER(TRIM(lead_email))
      ),
      sales AS (
        SELECT LOWER(TRIM(E_mail_do_Comprador)) AS email, Nome_do_Produto AS produto,
          MIN(COALESCE(Data_de_Aprova____o, Data_do_Pedido)) AS data_compra
        FROM ${tVendas}
        WHERE E_mail_do_Comprador IS NOT NULL ${stClause.sql}
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
  const stOnlyParams = stClause.params

  // ── A2: Tags por comprador ───────────────────────────────────────────────
  const tagsSql = `
    WITH
      buyers AS (
        SELECT DISTINCT LOWER(TRIM(E_mail_do_Comprador)) AS email
        FROM ${tVendas}
        WHERE Nome_do_Produto = @product ${stClause.sql} AND E_mail_do_Comprador IS NOT NULL
      ),
      buyer_tag_counts AS (
        SELECT LOWER(TRIM(lead_email)) AS email, COUNT(DISTINCT tag_name) AS num_tags
        FROM ${tLeads}
        WHERE tag_name IS NOT NULL AND LOWER(TRIM(lead_email)) IN (SELECT email FROM buyers)
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
    WHERE utm_content IS NOT NULL AND TRIM(utm_content) != ''
    GROUP BY utm_content ORDER BY cnt DESC LIMIT 50
  `

  // ── A4: Primeira entrada → vendas (por tag e por form) ───────────────────
  const firstEntrySql = `
    WITH
      buyers AS (
        SELECT DISTINCT LOWER(TRIM(E_mail_do_Comprador)) AS email
        FROM ${tVendas}
        WHERE Nome_do_Produto = @product ${stClause.sql} AND E_mail_do_Comprador IS NOT NULL
      ),
      leads_rn AS (
        SELECT
          LOWER(TRIM(lead_email)) AS email,
          tag_name, CAST(lead_register_form AS STRING) AS form,
          ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(lead_email)) ORDER BY lead_register) AS rn
        FROM ${tLeads} WHERE lead_email IS NOT NULL
      ),
      first_entry AS (
        SELECT l.email, l.tag_name AS first_tag, l.form AS first_form
        FROM leads_rn l INNER JOIN buyers b ON l.email = b.email WHERE l.rn = 1
      )
    SELECT first_tag AS category, 'tag' AS tipo, COUNT(*) AS compradores
    FROM first_entry WHERE first_tag IS NOT NULL GROUP BY first_tag ORDER BY compradores DESC LIMIT 30
    UNION ALL
    SELECT first_form, 'form', COUNT(*) AS compradores
    FROM first_entry WHERE first_form IS NOT NULL GROUP BY first_form ORDER BY compradores DESC LIMIT 30
  `

  // ── A5: Funil por UTM (3 dimensões) ─────────────────────────────────────
  function utmFunnelSql(utmCol: string): string {
    return `
      WITH
        first_utm AS (
          SELECT LOWER(TRIM(lead_email)) AS email, ${utmCol} AS utm_val,
            ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(lead_email)) ORDER BY lead_register) AS rn
          FROM ${tLeads} WHERE lead_email IS NOT NULL AND ${utmCol} IS NOT NULL AND TRIM(${utmCol}) != ''
        ),
        first_entries AS (SELECT email, utm_val FROM first_utm WHERE rn = 1),
        buyers AS (
          SELECT DISTINCT LOWER(TRIM(E_mail_do_Comprador)) AS email
          FROM ${tVendas}
          WHERE Nome_do_Produto = @product ${stClause.sql} AND E_mail_do_Comprador IS NOT NULL
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
        WHERE Nome_do_Produto = @product ${stClause.sql} AND E_mail_do_Comprador IS NOT NULL
      ),
      buyer_count AS (
        SELECT COUNT(*) AS total FROM buyers b
        WHERE b.email IN (SELECT DISTINCT LOWER(TRIM(lead_email)) FROM ${tLeads})
      )
    SELECT
      l.tag_name AS tag,
      COUNT(DISTINCT LOWER(TRIM(l.lead_email))) AS compradores,
      ROUND(100.0 * COUNT(DISTINCT LOWER(TRIM(l.lead_email))) / (SELECT total FROM buyer_count), 1) AS pct
    FROM ${tLeads} l INNER JOIN buyers b ON LOWER(TRIM(l.lead_email)) = b.email
    WHERE l.tag_name IS NOT NULL
    GROUP BY l.tag_name ORDER BY compradores DESC LIMIT 50
  `

  // ── Available tags & products ────────────────────────────────────────────
  const availTagsSql = `SELECT DISTINCT tag_name AS t FROM ${tLeads} WHERE tag_name IS NOT NULL ORDER BY t LIMIT 200`
  const availProdSql = `SELECT DISTINCT Nome_do_Produto AS p FROM ${tVendas} WHERE Nome_do_Produto IS NOT NULL ORDER BY p`

  try {
    const [
      ltcRes,
      ltcAllRes,
      tagsRes,
      utmCRes,
      firstEntryRes,
      utmF_content,
      utmF_campaign,
      utmF_medium,
      buyerTagsRes,
      availTagsRes,
      availProdRes,
    ] = await Promise.all([
      bqQuery(ltcSql, baseParams),
      bqQuery(ltcAllSql, stOnlyParams),
      bqQuery(tagsSql, baseParams),
      bqQuery(utmContentSql, []),
      bqQuery(firstEntrySql, baseParams),
      bqQuery(utmFunnelSql('utm_content'), baseParams),
      bqQuery(utmFunnelSql('utm_campaign'), baseParams),
      bqQuery(utmFunnelSql('utm_medium'), baseParams),
      bqQuery(buyerTagsSql, baseParams),
      bqQuery(availTagsSql, []),
      bqQuery(availProdSql, []),
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
      availableProducts: availProdRes.rows.map(r => r.p ?? '').filter(Boolean),
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
}
