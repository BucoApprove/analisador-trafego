/**
 * GET /api/lead-journey?email=xxx
 *   → histórico completo de um lead na base de leads + vendas
 *
 * GET /api/lead-journey?recentSales=1&product=xxx&limit=50
 *   → últimas vendas da Hotmart (para popular a lista de seleção)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { bqQuery, tableLeads, tableVendas } from './_bq.js'
import { authUser } from './_supabase-auth.js'

export interface LeadEvent {
  seq: number
  date: string          // ISO date string
  type: 'lead' | 'sale'
  tagName: string | null
  utmSource: string | null
  utmCampaign: string | null
  utmMedium: string | null
  utmContent: string | null
  product: string | null  // só em type=sale
}

export interface LeadJourneyResp {
  email: string
  name: string | null
  totalEvents: number
  totalSales: number
  events: LeadEvent[]
}

export interface RecentSale {
  email: string
  name: string
  product: string
  date: string
}

export interface RecentSalesResp {
  sales: RecentSale[]
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await authUser(req, res); if (!user) return
  res.setHeader('Cache-Control', 'no-store')

  const tLeads = tableLeads()
  const tVendas = tableVendas()

  // ── Últimas vendas (para a lista de seleção) ──────────────────────────────
  if (req.query.recentSales === '1') {
    const product = typeof req.query.product === 'string' ? req.query.product.trim() : ''
    const limit = Math.min(100, Math.max(10, parseInt(typeof req.query.limit === 'string' ? req.query.limit : '50') || 50))

    const productFilter = product
      ? `AND LOWER(Nome_do_Produto) LIKE CONCAT('%', LOWER(@product), '%')`
      : ''
    const params = product ? [{ name: 'product', value: product }] : []

    const sql = `
      SELECT
        LOWER(TRIM(E_mail_do_Comprador)) AS email,
        Nome_do_Comprador AS name,
        Nome_do_Produto AS product,
        CAST(COALESCE(Data_de_Aprova____o, Data_do_Pedido) AS STRING) AS sale_date
      FROM ${tVendas}
      WHERE E_mail_do_Comprador IS NOT NULL
        AND COALESCE(Data_de_Aprova____o, Data_do_Pedido) IS NOT NULL
        ${productFilter}
      ORDER BY COALESCE(Data_de_Aprova____o, Data_do_Pedido) DESC
      LIMIT ${limit}
    `

    try {
      const result = await bqQuery(sql, params)
      const sales: RecentSale[] = result.rows.map(r => ({
        email: r.email ?? '',
        name: r.name ?? '',
        product: r.product ?? '',
        date: (r.sale_date ?? '').slice(0, 10),
      })).filter(r => r.email)
      return res.json({ sales })
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message })
    }
  }

  // ── Jornada completa de um email ──────────────────────────────────────────
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : ''
  if (!email) return res.status(400).json({ error: 'email is required' })

  // Todos os registros de leads (cada tag/UTM = uma linha)
  const leadsSql = `
    SELECT
      lead_name,
      CAST(lead_register AS STRING) AS lead_register,
      tag_name,
      utm_source,
      utm_campaign,
      utm_medium,
      utm_content
    FROM ${tLeads}
    WHERE LOWER(TRIM(lead_email)) = @email
    ORDER BY lead_register ASC
  `

  // Todas as vendas deste email
  const salesSql = `
    SELECT
      Nome_do_Produto AS product,
      CAST(COALESCE(Data_de_Aprova____o, Data_do_Pedido) AS STRING) AS sale_date,
      Nome_do_Comprador AS name
    FROM ${tVendas}
    WHERE LOWER(TRIM(E_mail_do_Comprador)) = @email
      AND COALESCE(Data_de_Aprova____o, Data_do_Pedido) IS NOT NULL
    ORDER BY COALESCE(Data_de_Aprova____o, Data_do_Pedido) ASC
  `

  const params = [{ name: 'email', value: email }]

  try {
    const [leadsRes, salesRes] = await Promise.all([
      bqQuery(leadsSql, params),
      bqQuery(salesSql, params),
    ])

    const leadName = leadsRes.rows[0]?.lead_name ?? salesRes.rows[0]?.name ?? null

    // Monta eventos de leads
    const leadEvents: LeadEvent[] = leadsRes.rows.map((r, i) => ({
      seq: i + 1,
      date: (r.lead_register ?? '').slice(0, 10),
      type: 'lead' as const,
      tagName: r.tag_name ?? null,
      utmSource: r.utm_source ?? null,
      utmCampaign: r.utm_campaign ?? null,
      utmMedium: r.utm_medium ?? null,
      utmContent: r.utm_content ?? null,
      product: null,
    }))

    // Monta eventos de vendas
    const saleEvents: LeadEvent[] = salesRes.rows.map((r, i) => ({
      seq: i + 1,
      date: (r.sale_date ?? '').slice(0, 10),
      type: 'sale' as const,
      tagName: null,
      utmSource: null,
      utmCampaign: null,
      utmMedium: null,
      utmContent: null,
      product: r.product ?? null,
    }))

    // Mescla e renumera por data
    const allEvents = [...leadEvents, ...saleEvents]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e, i) => ({ ...e, seq: i + 1 }))

    return res.json({
      email,
      name: leadName,
      totalEvents: leadEvents.length,
      totalSales: saleEvents.length,
      events: allEvents,
    } satisfies LeadJourneyResp)
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
}
