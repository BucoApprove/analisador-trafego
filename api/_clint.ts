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

/** Lista as tags da Clint (id + nome) para o dropdown do editor.
 *  /v1/tags pagina por page/totalPages (não offset). */
export async function fetchClintTagsList(): Promise<Array<{ id: string; name: string }>> {
  const token = process.env.CLINT_API_TOKEN ?? ''
  if (!token) return []
  const out: Array<{ id: string; name: string }> = []
  let page = 1
  for (let i = 0; i < 100; i++) {
    const url = new URL(`${BASE}/v1/tags`)
    url.searchParams.set('limit', '100')
    url.searchParams.set('page', String(page))
    const r = await fetch(url.toString(), { headers: { 'api-token': token, Accept: 'application/json' } })
    if (!r.ok) throw new Error(`Clint /v1/tags ${r.status}`)
    const json = body2json(await r.text())
    const data = (json.data ?? []) as Array<{ id?: string; name?: string }>
    for (const t of data) if (t.id) out.push({ id: t.id, name: t.name ?? t.id })
    if (!json.hasNext || data.length === 0) break
    page++
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function body2json(body: string): { data?: unknown[]; hasNext?: boolean } {
  try { return body ? JSON.parse(body) : {} } catch { return {} }
}

interface Deal { id?: string; created_at?: string; fields?: { tipo?: string } }

// Coleta os deals de uma tag no período, mapeando id → tipo (Interessado/Abordado).
async function dealsByTag(token: string, tagId: string, since: string, until: string): Promise<Map<string, string>> {
  const byId = new Map<string, string>()
  let page = 1
  for (let i = 0; i < 100; i++) {
    const url = new URL(`${BASE}/v1/deals`)
    url.searchParams.set('tag_ids', tagId)
    url.searchParams.set('created_at_start', since)
    url.searchParams.set('created_at_end', until)
    url.searchParams.set('limit', '100')
    url.searchParams.set('page', String(page))
    const r = await fetch(url.toString(), { headers: { 'api-token': token, Accept: 'application/json' } })
    if (!r.ok) throw new Error(`Clint /v1/deals ${r.status}`)
    const json = JSON.parse((await r.text()) || '{}') as { data?: Deal[]; items?: Deal[]; hasNext?: boolean }
    const data = json.data ?? json.items ?? []
    if (data.length === 0) break
    for (const d of data) {
      const dt = (d.created_at ?? '').slice(0, 10)
      if (d.id && dt >= since && dt <= until) byId.set(d.id, d.fields?.tipo ?? '')
    }
    if (json.hasNext === false || data.length < 100) break
    page++
  }
  return byId
}

export interface ClintLeads { total: number; interessado: number; abordado: number }

/**
 * Conta leads Clint por produto canônico no período, separando Interessado e
 * Abordado (fields.tipo). Retorna {} se o token não estiver configurado.
 */
export async function fetchClintLeads(since: string, until: string): Promise<Record<string, ClintLeads>> {
  const token = process.env.CLINT_API_TOKEN ?? ''
  if (!token) return {}

  const tagsPorProduto = await fetchTagsPorProduto()
  const out: Record<string, ClintLeads> = {}
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  for (const [produto, tags] of Object.entries(tagsPorProduto)) {
    try {
      // dedup por deal entre as tags do produto; mantém o tipo do deal.
      const tipoById = new Map<string, string>()
      for (const tag of tags) {
        const byId = await dealsByTag(token, tag, since, until)
        for (const [id, tipo] of byId) if (!tipoById.has(id)) tipoById.set(id, tipo)
      }
      let interessado = 0, abordado = 0
      for (const tipo of tipoById.values()) {
        const t = norm(tipo)
        if (t === 'interessado') interessado++
        else if (t === 'abordado') abordado++
      }
      out[produto] = { total: tipoById.size, interessado, abordado }
    } catch (err) {
      console.error(`fetchClintLeads(${produto}) erro:`, (err as Error).message)
    }
  }
  return out
}
