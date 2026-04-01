/**
 * Busca vendas aprovadas da Hotmart por mês.
 *
 * Query params:
 *   month — formato YYYY-MM (ex: 2026-04). Default: mês atual.
 *
 * Env vars:
 *   HOTMART_TOKEN — Hottok de produção
 *   DASHBOARD_TOKEN / DASHBOARD_TOKEN_ADMIN
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'

function auth(req: VercelRequest, res: VercelResponse): boolean {
  const header = req.headers.authorization ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  const ok =
    (provided && provided === process.env.DASHBOARD_TOKEN_ADMIN) ||
    (provided && provided === process.env.DASHBOARD_TOKEN)
  if (!ok) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

interface HotmartItem {
  product?: { id: number; name: string }
  purchase?: {
    price?: { value: number; currency_value?: string }
    approved_date?: number
    status?: string
  }
  transaction?: string
}

interface HotmartResponse {
  items?: HotmartItem[]
  page_info?: { next_page_token?: string; total_results?: number }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!auth(req, res)) return

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')

  const hottok = process.env.HOTMART_TOKEN ?? ''
  if (!hottok) return res.status(500).json({ error: 'HOTMART_TOKEN não configurado' })

  // Determina o mês
  const monthParam = typeof req.query.month === 'string' ? req.query.month : ''
  const [year, month] = monthParam
    ? monthParam.split('-').map(Number)
    : [new Date().getFullYear(), new Date().getMonth() + 1]

  const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0)
  const endDate   = new Date(year, month, 0, 23, 59, 59, 999) // último dia do mês

  const startMs = startDate.getTime()
  const endMs   = endDate.getTime()

  try {
    // Busca paginada — Hotmart retorna até 500 por página
    let allItems: HotmartItem[] = []
    let nextPageToken: string | undefined

    do {
      const url = new URL('https://developers.hotmart.com/payments/api/v1/sales/history')
      url.searchParams.set('transaction_status', 'COMPLETE')
      url.searchParams.set('start_date', String(startMs))
      url.searchParams.set('end_date', String(endMs))
      url.searchParams.set('max_results', '500')
      if (nextPageToken) url.searchParams.set('page_token', nextPageToken)

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${hottok}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const txt = await response.text()
        return res.status(502).json({ error: `Hotmart API error ${response.status}`, detail: txt.substring(0, 300) })
      }

      const data: HotmartResponse = await response.json()
      allItems = allItems.concat(data.items ?? [])
      nextPageToken = data.page_info?.next_page_token
    } while (nextPageToken)

    // Agrupa por produto
    const byProduct = new Map<string, { id: number; name: string; total: number; count: number }>()

    for (const item of allItems) {
      const productId   = item.product?.id ?? 0
      const productName = item.product?.name ?? 'Desconhecido'
      const key = String(productId)
      const value = item.purchase?.price?.value ?? 0

      if (!byProduct.has(key)) {
        byProduct.set(key, { id: productId, name: productName, total: 0, count: 0 })
      }
      const entry = byProduct.get(key)!
      entry.total += value
      entry.count += 1
    }

    const products = [...byProduct.values()]
      .map(p => ({ ...p, total: Math.round(p.total * 100) / 100 }))
      .sort((a, b) => b.total - a.total)

    const grandTotal = Math.round(products.reduce((s, p) => s + p.total, 0) * 100) / 100

    res.json({
      month: `${year}-${String(month).padStart(2, '0')}`,
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      products,
      grandTotal,
      totalTransactions: allItems.length,
    })
  } catch (err) {
    console.error('hotmart-sales error:', err)
    res.status(500).json({ error: 'Erro interno', detail: (err as Error).message })
  }
}
