/**
 * Integração com a Clint (CRM) — contagem de leads (deals) por produto.
 *
 * Auth: header `api-token: {CLINT_API_TOKEN}`. Base https://api.clint.digital.
 * Leads = deals com a(s) tag(s) do produto, created_at no período, deduplicados
 * por id de deal. O mapa produto canônico → tags Clint vem da tabela
 * `clint_tags` (Supabase, editável na UI).
 *
 * Se CLINT_API_TOKEN não estiver configurado, retorna {} (a coluna mostra "—").
 */
import { createClient } from '@supabase/supabase-js'

const BASE = 'https://api.clint.digital'

/** Lê o mapa produto canônico → tags da tabela clint_tags. */
async function fetchTagsPorProduto(): Promise<Record<string, string[]>> {
  const sb = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_KEY ?? '', {
    auth: { persistSession: false },
  })
  const { data, error } = await sb.from('clint_tags').select('product_name, tag_id')
  if (error) throw new Error(`clint_tags: ${error.message}`)
  const map: Record<string, string[]> = {}
  for (const r of data ?? []) {
    if (!r.product_name || !r.tag_id) continue
    ;(map[r.product_name] ??= []).push(r.tag_id)
  }
  return map
}

interface Deal { id?: string; created_at?: string }

function lst(p: unknown): Deal[] {
  if (Array.isArray(p)) return p as Deal[]
  const o = p as { data?: Deal[]; items?: Deal[] }
  return o?.data ?? o?.items ?? []
}

async function dealsByTag(token: string, tagId: string, since: string, until: string): Promise<Set<string>> {
  const ids = new Set<string>()
  let offset = 0
  for (let i = 0; i < 40; i++) {
    const url = new URL(`${BASE}/v1/deals`)
    url.searchParams.set('tag_ids', tagId)
    url.searchParams.set('created_at_start', since)
    url.searchParams.set('created_at_end', until)
    url.searchParams.set('limit', '100')
    url.searchParams.set('offset', String(offset))
    const r = await fetch(url.toString(), { headers: { 'api-token': token, Accept: 'application/json' } })
    if (!r.ok) throw new Error(`Clint /v1/deals ${r.status}`)
    const body = await r.text()
    const data = lst(body ? JSON.parse(body) : [])
    if (data.length === 0) break
    for (const d of data) {
      // garante o filtro de data no cliente (a API às vezes ignora)
      const dt = (d.created_at ?? '').slice(0, 10)
      if (d.id && dt >= since && dt <= until) ids.add(d.id)
    }
    if (data.length < 100) break
    offset += 100
  }
  return ids
}

/**
 * Conta leads Clint por produto canônico no período. Retorna {} se o token
 * não estiver configurado ou em caso de falha (degrada para "—" na UI).
 */
export async function fetchClintLeads(since: string, until: string): Promise<Record<string, number>> {
  const token = process.env.CLINT_API_TOKEN ?? ''
  if (!token) return {}

  const tagsPorProduto = await fetchTagsPorProduto()
  const out: Record<string, number> = {}
  for (const [produto, tags] of Object.entries(tagsPorProduto)) {
    try {
      const seen = new Set<string>()
      for (const tag of tags) {
        const ids = await dealsByTag(token, tag, since, until)
        for (const id of ids) seen.add(id)
      }
      out[produto] = seen.size
    } catch (err) {
      console.error(`fetchClintLeads(${produto}) erro:`, (err as Error).message)
      // produto fica de fora; UI mostra "—"
    }
  }
  return out
}
