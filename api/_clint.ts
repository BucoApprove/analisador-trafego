/**
 * Integração com a Clint (CRM) — contagem de leads (deals) por produto.
 *
 * Auth: header `api-token: {CLINT_API_TOKEN}`. Base https://api.clint.digital.
 * Leads = deals com a(s) tag(s) do produto, created_at no período, deduplicados
 * por id de deal. Mapa produto canônico → tags Clint (UUIDs).
 *
 * Se CLINT_API_TOKEN não estiver configurado, retorna {} (a coluna mostra "—").
 */

const BASE = 'https://api.clint.digital'

// Produto canônico (mesmo nome do classifyProduto) → tags Clint (UUID).
// Origem: clint_leads.py (referência do sócio).
export const CLINT_TAGS_POR_PRODUTO: Record<string, string[]> = {
  'Buco Approve':     ['2749bbb9-d335-4077-a940-abfff6050264', '20ad2a94-14f2-4938-a13d-61e95fe4a31b'],
  'Intensivo ENARE':  ['95818d14-845a-4bea-9c53-f14bbb8f1dde', '447ceac5-f682-41fb-9691-77b59f35cbb6'],
  'Imersão ENARE':    ['97e5af6d-0d5d-4adf-a624-896333266cd6', 'b6c68687-3812-46f5-85d4-b862778a3df9'],
  'Mentoria CTBMF':   ['17f9aec7-0381-4b61-918d-c616ee387906'],
  'Pós Patologia':    ['7a7f2e78-eca6-4d03-bf78-9b517c4b9b60', 'a54d86f4-4d3f-4679-9491-784e51161cd4'],
  'Pós Anatomia':     ['211baf47-a20f-4497-a440-3fa7e4ecd4fb'],
  'Planejamento ImpulsoR+': ['3e6a901f-f27e-4902-bdc9-a8de113ae4c9'],
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

  const out: Record<string, number> = {}
  for (const [produto, tags] of Object.entries(CLINT_TAGS_POR_PRODUTO)) {
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
