/**
 * Computa atribuição de UTMs para compradores de um produto no período.
 *
 * Para cada dimensão (utm_source, utm_medium, utm_campaign, utm_content) e valor,
 * retorna 3 métricas de atribuição:
 *   - anyTime    : compradores que em algum momento tiveram aquela UTM
 *   - lastBefore : compradores cuja última UTM registrada antes da compra foi aquela
 *   - origin     : compradores cuja primeira UTM registrada na base foi aquela
 *
 * Compradores são identificados pela tabela de vendas (BQ_TABLE_VENDAS).
 * UTMs são buscadas na tabela de leads (BQ_TABLE_LEADS) para os emails dos compradores.
 *
 * GET /api/launch-sales-utms
 *   ?since=YYYY-MM-DD       — data inicial das compras (default: 1º do mês)
 *   &until=YYYY-MM-DD       — data final das compras (default: hoje)
 *   &productFilter=buco+approve — filtro LIKE para Nome_do_Produto (default: '%buco%approve%')
 *
 * Env vars:
 *   BQ_VENDAS_EMAIL_COL — coluna de email na tabela de vendas (default: Email_do_Comprador)
 *   BQ_VENDAS_DATE_COL  — coluna de data de aprovação (default: Data_de_Aprova____o)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { bqQuery, tableLeads, tableVendas } from './_bq.js'
import { authUser } from './_supabase-auth.js'

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function firstOfMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

interface UtmRecord {
  date: string          // 'YYYY-MM-DD'
  source:   string | null
  medium:   string | null
  campaign: string | null
  content:  string | null
}

interface BuyerData {
  purchaseDate: string  // 'YYYY-MM-DD'
  utms: UtmRecord[]
}

type DimKey = 'source' | 'medium' | 'campaign' | 'content'
const DIMS: DimKey[] = ['source', 'medium', 'campaign', 'content']

interface DimCounters {
  anyTime:    Set<string>
  lastBefore: Set<string>
  origin:     Set<string>
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const _user = await authUser(req, res); if (!_user) return

  const since = typeof req.query.since === 'string' ? req.query.since : firstOfMonthStr()
  const until = typeof req.query.until === 'string' ? req.query.until : todayStr()
  const productFilter = typeof req.query.productFilter === 'string'
    ? `%${req.query.productFilter.toLowerCase()}%`
    : '%buco%approve%'

  const emailCol = process.env.BQ_VENDAS_EMAIL_COL ?? 'E_mail_do_Comprador'
  const dateCol  = process.env.BQ_VENDAS_DATE_COL  ?? 'Data_de_Aprova____o'

  const tLeads  = tableLeads()
  const tVendas = tableVendas()

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')

  try {
    // ── Query única com CTE ────────────────────────────────────────────────────
    // 1. buyers: emails dos compradores no período, com data da primeira compra
    // 2. utm_history: todos os registros de UTM desses compradores na tabela de leads
    const sql = `
      WITH buyers AS (
        SELECT
          LOWER(TRIM(\`${emailCol}\`)) AS lead_email,
          MIN(\`${dateCol}\`)          AS purchase_date
        FROM ${tVendas}
        WHERE Status IN ('COMPLETO', 'APROVADO')
          AND LOWER(TRIM(Nome_do_Produto)) LIKE @productFilter
          AND \`${emailCol}\` IS NOT NULL
          AND TRIM(\`${emailCol}\`) <> ''
          AND \`${dateCol}\` >= @since
          AND \`${dateCol}\` <= @until
        GROUP BY LOWER(TRIM(\`${emailCol}\`))
      ),
      utm_history AS (
        SELECT
          l.lead_email,
          b.purchase_date,
          DATE(l.lead_register)    AS utm_date,
          l.utm_source,
          l.utm_campaign,
          l.utm_medium,
          l.utm_content
        FROM ${tLeads} l
        INNER JOIN buyers b ON LOWER(TRIM(l.lead_email)) = b.lead_email
        WHERE l.utm_source   IS NOT NULL
           OR l.utm_campaign IS NOT NULL
           OR l.utm_medium   IS NOT NULL
           OR l.utm_content  IS NOT NULL
      )
      SELECT
        lead_email,
        purchase_date,
        utm_date,
        utm_source,
        utm_campaign,
        utm_medium,
        utm_content
      FROM utm_history
      ORDER BY lead_email, utm_date
    `

    const result = await bqQuery(sql, [
      { name: 'productFilter', value: productFilter },
      { name: 'since',         value: since },
      { name: 'until',         value: until },
    ])

    // ── Agrupa por comprador ──────────────────────────────────────────────────
    const buyers = new Map<string, BuyerData>()

    for (const row of result.rows) {
      const email        = row.lead_email       ?? ''
      const purchaseDate = row.purchase_date    ?? ''
      if (!email || !purchaseDate) continue

      if (!buyers.has(email)) {
        buyers.set(email, { purchaseDate, utms: [] })
      }

      buyers.get(email)!.utms.push({
        date:     row.utm_date     ?? '',
        source:   row.utm_source   ?? null,
        medium:   row.utm_medium   ?? null,
        campaign: row.utm_campaign ?? null,
        content:  row.utm_content  ?? null,
      })
    }

    // ── Computa as 3 métricas por dimensão ────────────────────────────────────
    const counters: Record<DimKey, Map<string, DimCounters>> = {
      source:   new Map(),
      medium:   new Map(),
      campaign: new Map(),
      content:  new Map(),
    }

    function getCounter(dim: DimKey, value: string): DimCounters {
      if (!counters[dim].has(value)) {
        counters[dim].set(value, {
          anyTime:    new Set(),
          lastBefore: new Set(),
          origin:     new Set(),
        })
      }
      return counters[dim].get(value)!
    }

    for (const [email, { purchaseDate, utms }] of buyers) {
      if (utms.length === 0) continue

      // já está ordenado por utm_date (ORDER BY na query)
      const sorted = utms

      // last-before: último registro com data <= data da compra
      const beforePurchase = sorted.filter(u => u.date && purchaseDate && u.date <= purchaseDate)
      const lastBefore = beforePurchase.length > 0 ? beforePurchase[beforePurchase.length - 1] : null

      // origin: primeiro registro de UTM (qualquer data)
      const origin = sorted[0]

      // anyTime: conta para cada valor distinto que o comprador já teve
      const seen: Partial<Record<DimKey, Set<string>>> = {}
      for (const dim of DIMS) seen[dim] = new Set()

      for (const utm of sorted) {
        for (const dim of DIMS) {
          const val = utm[dim]
          if (!val || seen[dim]!.has(val)) continue
          seen[dim]!.add(val)
          getCounter(dim, val).anyTime.add(email)
        }
      }

      // lastBefore
      if (lastBefore) {
        for (const dim of DIMS) {
          const val = lastBefore[dim]
          if (val) getCounter(dim, val).lastBefore.add(email)
        }
      }

      // origin
      if (origin) {
        for (const dim of DIMS) {
          const val = origin[dim]
          if (val) getCounter(dim, val).origin.add(email)
        }
      }
    }

    // ── Formata resposta ──────────────────────────────────────────────────────
    function toArray(dim: DimKey) {
      return [...counters[dim].entries()]
        .map(([name, c]) => ({
          name,
          anyTime:    c.anyTime.size,
          lastBefore: c.lastBefore.size,
          origin:     c.origin.size,
        }))
        .sort((a, b) => b.anyTime - a.anyTime)
    }

    res.json({
      totalBuyers: buyers.size,
      since,
      until,
      bySource:   toArray('source'),
      byMedium:   toArray('medium'),
      byCampaign: toArray('campaign'),
      byContent:  toArray('content'),
    })
  } catch (err) {
    console.error('launch-sales-utms error:', err)
    res.status(500).json({ error: 'Erro interno', detail: (err as Error).message })
  }
}
