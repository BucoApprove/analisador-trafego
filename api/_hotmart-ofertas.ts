/**
 * Mapa code → nome das ofertas de um produto Hotmart (Products API).
 *
 * Usado para mostrar o nome legível das ofertas no drill-down do BucoApprove,
 * em vez do code cru (ex: "9whvh53d" → "Perpétuo BA + Planejamento").
 *
 * 1. /products?max_results=100  → acha o produto por id, pega o ucode
 * 2. /products/{ucode}/offers   → code → name de cada oferta
 *
 * Cache em memória por process (as ofertas mudam raramente). TTL longo.
 */

interface OffersCache { offers: Record<string, string>; at: number }
const cache = new Map<number, OffersCache>()
const TTL_MS = 6 * 60 * 60 * 1000  // 6h

async function getJson(url: string, token: string): Promise<Record<string, unknown>> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
  if (!r.ok) throw new Error(`${new URL(url).pathname} → ${r.status}`)
  return r.json() as Promise<Record<string, unknown>>
}

async function getUcode(token: string, productId: number): Promise<string | null> {
  const data = await getJson('https://developers.hotmart.com/products/api/v1/products?max_results=100', token)
  const items = (data.items as Array<{ id?: number; ucode?: string }>) ?? []
  return items.find(p => p.id === productId)?.ucode ?? null
}

/**
 * Retorna { offer_code → nome } das ofertas do produto. Em caso de qualquer
 * falha (API fora, sem ucode), retorna {} — o chamador faz fallback para o code.
 */
export async function fetchOfertaNomes(productId: number, token: string): Promise<Record<string, string>> {
  const cached = cache.get(productId)
  if (cached && Date.now() - cached.at < TTL_MS) return cached.offers

  try {
    const ucode = await getUcode(token, productId)
    if (!ucode) return {}

    const offers: Record<string, string> = {}
    let pageToken: string | undefined
    for (let i = 0; i < 10; i++) {
      const url = new URL(`https://developers.hotmart.com/products/api/v1/products/${ucode}/offers`)
      url.searchParams.set('max_results', '50')
      if (pageToken) url.searchParams.set('page_token', pageToken)
      const data = await getJson(url.toString(), token)
      for (const o of (data.items as Array<{ code?: string; name?: string }>) ?? []) {
        if (o.code) offers[o.code] = o.name ?? ''
      }
      pageToken = (data.page_info as { next_page_token?: string })?.next_page_token
      if (!pageToken) break
    }

    cache.set(productId, { offers, at: Date.now() })
    return offers
  } catch (err) {
    console.error('fetchOfertaNomes error:', (err as Error).message)
    return {}
  }
}
