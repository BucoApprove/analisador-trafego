/**
 * Busca vendas aprovadas da Hotmart por mês via OAuth2 client_credentials.
 *
 * Query params:
 *   month — formato YYYY-MM (ex: 2026-04). Default: mês atual.
 *
 * Env vars:
 *   HOTMART_CLIENT_ID     — client_id do app Hotmart
 *   HOTMART_CLIENT_SECRET — client_secret do app Hotmart
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

async function getAccessToken(): Promise<string> {
  const clientId     = process.env.HOTMART_CLIENT_ID ?? ''
  const clientSecret = process.env.HOTMART_CLIENT_SECRET ?? ''
  if (!clientId || !clientSecret) throw new Error('HOTMART_CLIENT_ID / HOTMART_CLIENT_SECRET não configurados')

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const resp = await fetch(
    'https://api-sec-vlc.hotmart.com/security/oauth/token?grant_type=client_credentials',
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
      },
    },
  )

  if (!resp.ok) {
    const txt = await resp.text()
    throw new Error(`Hotmart OAuth error ${resp.status}: ${txt.substring(0, 200)}`)
  }

  const data = await resp.json() as { access_token?: string }
  if (!data.access_token) throw new Error('Hotmart OAuth: access_token ausente na resposta')
  return data.access_token
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

  // Determina o mês
  const monthParam = typeof req.query.month === 'string' ? req.query.month : ''
  const [year, month] = monthParam
    ? monthParam.split('-').map(Number)
    : [new Date().getFullYear(), new Date().getMonth() + 1]

  const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0)
  const endDate   = new Date(year, month, 0, 23, 59, 59, 999)

  const startMs = startDate.getTime()
  const endMs   = endDate.getTime()

  try {
    const accessToken = await getAccessToken()

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
          Authorization: `Bearer ${accessToken}`,
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
