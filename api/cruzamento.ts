/**
 * Cruzamento de produtos A→B.
 * POST /api/cruzamento
 *   body: { groupA: string[], productB: string, statuses: string[] }
 *
 * GET /api/cruzamento?mode=products  → retorna lista de produtos disponíveis
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { QueryParam } from './_bq.js'
import { bqQuery, tableVendas } from './_bq.js'

function auth(req: VercelRequest, res: VercelResponse): boolean {
  const header = req.headers.authorization ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  const ok =
    (provided && provided === process.env.DASHBOARD_TOKEN_ADMIN) ||
    (provided && provided === process.env.DASHBOARD_TOKEN)
  if (!ok) { res.status(401).json({ error: 'Unauthorized' }); return false }
  return true
}

function inClause(col: string, values: string[], prefix: string): { sql: string; params: QueryParam[] } {
  if (values.length === 0) return { sql: '1=0', params: [] }
  const names = values.map((_, i) => `@${prefix}_${i}`)
  return {
    sql: `${col} IN (${names.join(', ')})`,
    params: values.map((v, i) => ({ name: `${prefix}_${i}`, value: v })),
  }
}

function statusClause(statuses: string[]): { sql: string; params: QueryParam[] } {
  if (statuses.length === 0) return { sql: '', params: [] }
  const { sql, params } = inClause('Status', statuses, 'st')
  return { sql: ` AND ${sql}`, params }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!auth(req, res)) return

  const tVendas = tableVendas()

  // GET /api/cruzamento?mode=products
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120')
    try {
      const [rProducts, rStatuses] = await Promise.all([
        bqQuery(`SELECT DISTINCT Nome_do_Produto AS p FROM ${tVendas} WHERE Nome_do_Produto IS NOT NULL ORDER BY p`),
        bqQuery(`SELECT DISTINCT Status AS s FROM ${tVendas} WHERE Status IS NOT NULL ORDER BY s`),
      ])
      return res.json({
        products: rProducts.rows.map(r => r.p ?? '').filter(Boolean),
        statuses: rStatuses.rows.map(r => r.s ?? '').filter(Boolean),
      })
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message })
    }
  }

  // POST /api/cruzamento
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { groupA, productB, statuses = [] } = req.body as {
    groupA: string[]
    productB: string
    statuses: string[]
  }

  if (!Array.isArray(groupA) || groupA.length === 0 || !productB) {
    return res.status(400).json({ error: 'groupA and productB are required' })
  }

  const stClause = statusClause(statuses)
  const gaClause = inClause('Nome_do_Produto', groupA, 'ga')

  // id_comprador: CPF normalizado ou nome normalizado
  const idCompradorExpr = `CASE
    WHEN REGEXP_REPLACE(IFNULL(CAST(CPF_CNPJ_Comprador AS STRING), ''), r'[^0-9]', '') != ''
      THEN REGEXP_REPLACE(IFNULL(CAST(CPF_CNPJ_Comprador AS STRING), ''), r'[^0-9]', '')
    ELSE LOWER(TRIM(IFNULL(Nome_do_Comprador, '')))
  END`

  const commonCTE = `
    base AS (
      SELECT
        ${idCompradorExpr} AS id_comprador,
        Nome_do_Produto AS produto,
        IFNULL(Nome_do_Comprador, '') AS nome,
        IFNULL(E_mail_do_Comprador, '') AS email,
        COALESCE(Data_de_Aprova____o, Data_do_Pedido) AS data_efetiva
      FROM ${tVendas}
      WHERE ${idCompradorExpr} != ''
      ${stClause.sql}
    ),
    buyers_a AS (
      SELECT
        id_comprador,
        MIN(data_efetiva) AS data_a,
        ANY_VALUE(nome) AS nome,
        ANY_VALUE(email) AS email,
        ARRAY_AGG(DISTINCT produto ORDER BY produto LIMIT 1)[OFFSET(0)] AS produto_a
      FROM base
      WHERE ${gaClause.sql}
      GROUP BY id_comprador
    ),
    buyers_b AS (
      SELECT id_comprador, MIN(data_efetiva) AS data_b
      FROM base
      WHERE Nome_do_Produto = @product_b
      GROUP BY id_comprador
    )
  `

  const allParams: QueryParam[] = [
    ...stClause.params,
    ...gaClause.params,
    { name: 'product_b', value: productB },
  ]

  // Query 1: cross detail (max 500 rows)
  const crossDetailSql = `
    WITH ${commonCTE},
    cross_data AS (
      SELECT
        a.id_comprador, a.nome, a.email, a.produto_a,
        CAST(a.data_a AS STRING) AS data_a,
        CAST(b.data_b AS STRING) AS data_b,
        DATE_DIFF(CAST(b.data_b AS DATE), CAST(a.data_a AS DATE), DAY) AS dias_entre,
        CASE
          WHEN a.data_a < b.data_b THEN 'A primeiro'
          WHEN b.data_b < a.data_a THEN 'B primeiro'
          ELSE 'Mesma data'
        END AS sequencia
      FROM buyers_a a
      INNER JOIN buyers_b b ON a.id_comprador = b.id_comprador
    )
    SELECT * FROM cross_data ORDER BY data_a DESC LIMIT 500
  `

  // Query 2: summary counts
  const countsSql = `
    WITH ${commonCTE},
    intersection AS (
      SELECT
        a.id_comprador,
        DATE_DIFF(CAST(b.data_b AS DATE), CAST(a.data_a AS DATE), DAY) AS dias,
        CASE
          WHEN a.data_a < b.data_b THEN 'A'
          WHEN b.data_b < a.data_a THEN 'B'
          ELSE 'same'
        END AS first_buyer
      FROM buyers_a a
      INNER JOIN buyers_b b ON a.id_comprador = b.id_comprador
    )
    SELECT
      (SELECT COUNT(*) FROM buyers_a) AS cnt_a,
      (SELECT COUNT(*) FROM buyers_b) AS cnt_b,
      COUNT(*) AS cnt_both,
      COUNTIF(first_buyer = 'A') AS cnt_a_first,
      COUNTIF(first_buyer = 'B') AS cnt_b_first,
      COUNTIF(first_buyer = 'same') AS cnt_same,
      ROUND(AVG(CASE WHEN first_buyer = 'A' THEN CAST(dias AS FLOAT64) END), 1) AS avg_dias_a_to_b,
      (SELECT COUNT(*) FROM buyers_a WHERE id_comprador NOT IN (SELECT id_comprador FROM buyers_b)) AS cnt_only_a,
      (SELECT COUNT(*) FROM buyers_b WHERE id_comprador NOT IN (SELECT id_comprador FROM buyers_a)) AS cnt_only_b
    FROM intersection
  `

  res.setHeader('Cache-Control', 'no-store')

  try {
    const [crossResult, countsResult] = await Promise.all([
      bqQuery(crossDetailSql, allParams),
      bqQuery(countsSql, allParams),
    ])

    const counts = countsResult.rows[0] ?? {}
    const cntA = parseInt(counts.cnt_a ?? '0')
    const cntB = parseInt(counts.cnt_b ?? '0')
    const cntBoth = parseInt(counts.cnt_both ?? '0')
    const cntAFirst = parseInt(counts.cnt_a_first ?? '0')
    const cntBFirst = parseInt(counts.cnt_b_first ?? '0')
    const cntSame = parseInt(counts.cnt_same ?? '0')
    const avgDias = counts.avg_dias_a_to_b != null ? parseFloat(counts.avg_dias_a_to_b) : null
    const taxaConversao =
      cntA > 0 ? ((cntAFirst / cntA) * 100).toFixed(1) : '0.0'

    const allRows = crossResult.rows.map(r => ({
      nome: r.nome ?? '',
      email: r.email ?? '',
      produtoA: r.produto_a ?? '',
      dataA: r.data_a ?? null,
      dataB: r.data_b ?? null,
      diasEntre: r.dias_entre != null ? parseInt(r.dias_entre) : null,
      sequencia: r.sequencia ?? '',
    }))

    const intersection = allRows.filter(r => r.sequencia === 'A primeiro')
    const bFirst = allRows.filter(r => r.sequencia === 'B primeiro' || r.sequencia === 'Mesma data')

    res.json({
      summary: {
        totalGrupoA: cntA,
        totalProdutoB: cntB,
        compraramAmbos: cntAFirst,
        bPrimeiro: cntBFirst,
        mesmaDia: cntSame,
        taxaConversao,
        mediaDiasAtoB: avgDias,
      },
      intersection,
      bFirst,
      onlyACount: parseInt(counts.cnt_only_a ?? '0'),
      onlyBCount: parseInt(counts.cnt_only_b ?? '0'),
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
}
