/**
 * Tabela de vendas Hotmart/Greenn com filtros e métricas.
 *
 * GET /api/vendas-data
 *   ?offset=0         — paginação (default: 0)
 *   &status=X         — filtrar por Status (repetível)
 *   &product=X        — filtrar por produto (repetível)
 *   &state=X          — filtrar por estado (repetível)
 *   &paymentMethod=X  — filtrar por método de pagamento (repetível)
 *   &dateFrom=YYYY-MM-DD
 *   &dateTo=YYYY-MM-DD
 *   &export=1         — retorna até 5000 linhas sem paginação
 *   &mode=options     — retorna só as opções de filtro
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { QueryParam } from './_bq.js'
import { bqQuery, tableVendas } from './_bq.js'

const PAGE_SIZE = 50

function auth(req: VercelRequest, res: VercelResponse): boolean {
  const header = req.headers.authorization ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  const ok =
    (provided && provided === process.env.DASHBOARD_TOKEN_ADMIN) ||
    (provided && provided === process.env.DASHBOARD_TOKEN)
  if (!ok) { res.status(401).json({ error: 'Unauthorized' }); return false }
  return true
}

/** Converts a repeated query param to a string array (handles string | string[]). */
function toArray(val: string | string[] | undefined): string[] {
  if (!val) return []
  return Array.isArray(val) ? val.filter(Boolean) : [val].filter(Boolean)
}

/** Builds " AND col IN (@p_0, @p_1, ...)" and params. Empty = no clause. */
function inClause(col: string, values: string[], prefix: string): { sql: string; params: QueryParam[] } {
  if (values.length === 0) return { sql: '', params: [] }
  const names = values.map((_, i) => `@${prefix}_${i}`)
  return {
    sql: ` AND ${col} IN (${names.join(', ')})`,
    params: values.map((v, i) => ({ name: `${prefix}_${i}`, value: v })),
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!auth(req, res)) return

  const tVendas = tableVendas()
  const mode = typeof req.query.mode === 'string' ? req.query.mode : ''
  const isExport = req.query.export === '1'

  // ── Apenas opções de filtro ──────────────────────────────────────────────
  if (mode === 'options') {
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120')
    try {
      const [rStatuses, rProducts, rStates, rMethods] = await Promise.all([
        bqQuery(`SELECT DISTINCT Status FROM ${tVendas} WHERE Status IS NOT NULL ORDER BY Status`),
        bqQuery(`SELECT DISTINCT Nome_do_Produto FROM ${tVendas} WHERE Nome_do_Produto IS NOT NULL ORDER BY Nome_do_Produto`),
        bqQuery(`SELECT DISTINCT Estado_do_Comprador FROM ${tVendas} WHERE Estado_do_Comprador IS NOT NULL ORDER BY Estado_do_Comprador`),
        bqQuery(`SELECT DISTINCT M__todo_de_Pagamento FROM ${tVendas} WHERE M__todo_de_Pagamento IS NOT NULL ORDER BY M__todo_de_Pagamento`),
      ])
      return res.json({
        statuses: rStatuses.rows.map(r => r.Status ?? '').filter(Boolean),
        products: rProducts.rows.map(r => r.Nome_do_Produto ?? '').filter(Boolean),
        states: rStates.rows.map(r => r.Estado_do_Comprador ?? '').filter(Boolean),
        paymentMethods: rMethods.rows.map(r => r.M__todo_de_Pagamento ?? '').filter(Boolean),
      })
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message })
    }
  }

  // ── Parâmetros de filtro ─────────────────────────────────────────────────
  const statuses = toArray(req.query.status)
  const products = toArray(req.query.product)
  const states = toArray(req.query.state)
  const paymentMethods = toArray(req.query.paymentMethod)
  const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : ''
  const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : ''
  const offset = Math.max(0, parseInt(typeof req.query.offset === 'string' ? req.query.offset : '0') || 0)

  const sClause = inClause('Status', statuses, 'st')
  const pClause = inClause('Nome_do_Produto', products, 'pr')
  const eClause = inClause('Estado_do_Comprador', states, 'es')
  const mClause = inClause('M__todo_de_Pagamento', paymentMethods, 'pm')

  let dateSql = ''
  const dateParams: QueryParam[] = []
  if (dateFrom) {
    dateSql += ` AND CAST(Data_do_Pedido AS DATE) >= @dateFrom`
    dateParams.push({ name: 'dateFrom', value: dateFrom })
  }
  if (dateTo) {
    dateSql += ` AND CAST(Data_do_Pedido AS DATE) <= @dateTo`
    dateParams.push({ name: 'dateTo', value: dateTo })
  }

  const whereClause = `WHERE 1=1${sClause.sql}${pClause.sql}${eClause.sql}${mClause.sql}${dateSql}`
  const allParams: QueryParam[] = [...sClause.params, ...pClause.params, ...eClause.params, ...mClause.params, ...dateParams]

  const limit = isExport ? 5000 : PAGE_SIZE

  const selectSql = `
    SELECT
      CAST(ID_Transa____o AS STRING) AS txn_id,
      CAST(Data_do_Pedido AS STRING) AS data_pedido,
      CAST(Data_de_Aprova____o AS STRING) AS data_aprovacao,
      IFNULL(Nome_do_Comprador, '') AS nome_comprador,
      IFNULL(E_mail_do_Comprador, '') AS email_comprador,
      Telefone_do_Comprador AS telefone,
      Cidade_do_Comprador AS cidade,
      Estado_do_Comprador AS estado,
      IFNULL(Nome_do_Produto, '') AS produto,
      CAST(Valor_do_Produto AS STRING) AS valor_produto,
      CAST(Valor_Pago_pelo_Comprador_Sem_Taxas_e_Impostos AS STRING) AS valor_pago,
      IFNULL(Status, '') AS status,
      M__todo_de_Pagamento AS metodo_pagamento,
      CAST(N__mero_de_Parcelas AS STRING) AS parcelas
    FROM ${tVendas}
    ${whereClause}
    ORDER BY Data_do_Pedido DESC
    LIMIT ${limit}
    ${isExport ? '' : `OFFSET @offset`}
  `
  const queryParams = isExport ? allParams : [...allParams, { name: 'offset', value: offset, type: 'INT64' as const }]

  const metricsSql = `
    SELECT
      COUNT(*) AS total,
      COUNT(DISTINCT
        CASE WHEN REGEXP_REPLACE(IFNULL(CAST(CPF_CNPJ_Comprador AS STRING), ''), r'[^0-9]', '') != ''
          THEN REGEXP_REPLACE(IFNULL(CAST(CPF_CNPJ_Comprador AS STRING), ''), r'[^0-9]', '')
          ELSE LOWER(TRIM(IFNULL(Nome_do_Comprador, '')))
        END
      ) AS unique_buyers,
      SUM(IFNULL(Valor_Pago_pelo_Comprador_Sem_Taxas_e_Impostos, 0)) AS revenue,
      COUNT(DISTINCT Nome_do_Produto) AS distinct_products
    FROM ${tVendas}
    ${whereClause}
  `

  res.setHeader('Cache-Control', isExport ? 'no-store' : 's-maxage=120, stale-while-revalidate=30')

  try {
    const [dataResult, metricsResult, rStatuses, rProducts, rStates, rMethods] = await Promise.all([
      bqQuery(selectSql, queryParams),
      bqQuery(metricsSql, allParams),
      bqQuery(`SELECT DISTINCT Status FROM ${tVendas} WHERE Status IS NOT NULL ORDER BY Status`),
      bqQuery(`SELECT DISTINCT Nome_do_Produto FROM ${tVendas} WHERE Nome_do_Produto IS NOT NULL ORDER BY Nome_do_Produto`),
      bqQuery(`SELECT DISTINCT Estado_do_Comprador FROM ${tVendas} WHERE Estado_do_Comprador IS NOT NULL ORDER BY Estado_do_Comprador`),
      bqQuery(`SELECT DISTINCT M__todo_de_Pagamento FROM ${tVendas} WHERE M__todo_de_Pagamento IS NOT NULL ORDER BY M__todo_de_Pagamento`),
    ])

    const totalRows = parseInt(metricsResult.rows[0]?.total ?? '0')
    const nextOffset = offset + PAGE_SIZE
    const nextCursor = (!isExport && nextOffset < totalRows) ? String(nextOffset) : null

    const vendas = dataResult.rows.map(r => ({
      txnId: r.txn_id ?? '',
      dataPedido: r.data_pedido ?? null,
      dataAprovacao: r.data_aprovacao ?? null,
      nomeComprador: r.nome_comprador ?? '',
      emailComprador: r.email_comprador ?? '',
      telefone: r.telefone ?? null,
      cidade: r.cidade ?? null,
      estado: r.estado ?? null,
      produto: r.produto ?? '',
      valorProduto: r.valor_produto != null ? parseFloat(r.valor_produto) : null,
      valorPago: r.valor_pago != null ? parseFloat(r.valor_pago) : null,
      status: r.status ?? '',
      metodoPagamento: r.metodo_pagamento ?? null,
      parcelas: r.parcelas ?? null,
    }))

    res.json({
      vendas,
      total: totalRows,
      nextCursor,
      metrics: {
        total: totalRows,
        uniqueBuyers: parseInt(metricsResult.rows[0]?.unique_buyers ?? '0'),
        revenue: parseFloat(metricsResult.rows[0]?.revenue ?? '0'),
        distinctProducts: parseInt(metricsResult.rows[0]?.distinct_products ?? '0'),
      },
      filters: {
        statuses: rStatuses.rows.map(r => r.Status ?? '').filter(Boolean),
        products: rProducts.rows.map(r => r.Nome_do_Produto ?? '').filter(Boolean),
        states: rStates.rows.map(r => r.Estado_do_Comprador ?? '').filter(Boolean),
        paymentMethods: rMethods.rows.map(r => r.M__todo_de_Pagamento ?? '').filter(Boolean),
      },
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
}
