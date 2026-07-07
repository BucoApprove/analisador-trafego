/**
 * Integração com a Clint (CRM) — contagem de leads (deals) por produto.
 *
 * Lógica correta (descoberta via debug em 2026-07-07):
 *   - A API Clint organiza origens em grupos (group.name = produto).
 *   - O painel "Novos interessados por produto" conta todos os deals
 *     criados no período por group.name, independente do campo fields.tipo.
 *   - A integração antiga usava tag_id e fields.tipo, que retornavam
 *     números muito abaixo do real.
 *
 * Nova lógica:
 *   1. Carrega /v1/origins → mapeia origin_id → { grupo, funil }
 *   2. Busca todos os deals do período (sem filtro de tag)
 *   3. Agrupa por group.name do origin, contando total/interessado/abordado
 *      (fields.tipo quando preenchido; deal sem tipo = conta no total)
 *   4. Mapeia group.name → produto canônico via tabela clint_tags (Supabase)
 *      mantendo a UI existente de configuração
 */
import { createClient } from '@supabase/supabase-js'

const BASE = 'https://api.clint.digital'

function body2json(body: string): unknown {
  try { return body ? JSON.parse(body) : {} } catch { return {} }
}

// ─── Tipos da API Clint ───────────────────────────────────────────────────────

interface ClintOrigin {
  id: string
  name: string
  group: { id: string; name: string }
  archived_at: string | null
}

interface ClintDeal {
  id: string
  origin_id: string
  created_at: string
  fields: { tipo?: string } | Record<string, unknown>
}

// ─── Cache de origens (evita re-buscar a cada chamada) ───────────────────────

let _originsCache: { map: Map<string, ClintOrigin>; ts: number } | null = null
const CACHE_TTL = 10 * 60 * 1000 // 10 min

async function fetchOrigins(token: string): Promise<Map<string, ClintOrigin>> {
  const now = Date.now()
  if (_originsCache && now - _originsCache.ts < CACHE_TTL) return _originsCache.map

  const r = await fetch(`${BASE}/v1/origins?limit=200&page=1`, {
    headers: { 'api-token': token, Accept: 'application/json' },
  })
  if (!r.ok) throw new Error(`Clint /v1/origins ${r.status}`)
  const j = body2json(await r.text()) as { data?: ClintOrigin[] }
  const map = new Map<string, ClintOrigin>()
  for (const o of j.data ?? []) map.set(o.id, o)
  _originsCache = { map, ts: now }
  return map
}

// ─── Busca todos os deals do período (sem filtro de tag) ─────────────────────

async function fetchAllDeals(token: string, since: string, until: string): Promise<ClintDeal[]> {
  const all: ClintDeal[] = []
  const untilEod = `${until}T23:59:59`
  let page = 1

  for (let i = 0; i < 200; i++) {
    const u = new URL(`${BASE}/v1/deals`)
    u.searchParams.set('limit', '100')
    u.searchParams.set('page', String(page))
    u.searchParams.set('created_at_start', since)
    u.searchParams.set('created_at_end', untilEod)
    const r = await fetch(u.toString(), { headers: { 'api-token': token, Accept: 'application/json' } })
    if (!r.ok) throw new Error(`Clint /v1/deals ${r.status}`)
    const j = body2json(await r.text()) as { data?: ClintDeal[]; hasNext?: boolean }
    const data = j.data ?? []
    all.push(...data)
    if (!j.hasNext || data.length === 0) break
    page++
  }
  return all
}

// ─── Mapa produto canônico → group names da Clint (via clint_tags no Supabase) ─

async function fetchGroupsPorProduto(): Promise<Record<string, string[]>> {
  const sb = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_KEY ?? '', {
    auth: { persistSession: false },
  })
  // clint_tags armazena product_name → tag_id, mas agora usamos tag_id como group name
  // Para manter compatibilidade, permitimos que tag_id seja um UUID de origin OU
  // um nome de grupo (string livre). O mapeamento é: product_name → [group_names]
  const { data, error } = await sb.from('clint_tags').select('product_name, tag_id, label')
  if (error) throw new Error(`clint_tags: ${error.message}`)
  const map: Record<string, string[]> = {}
  for (const r of data ?? []) {
    if (!r.product_name) continue
    // Usa o label (nome do grupo) se disponível, senão tag_id
    const groupName = r.label || r.tag_id
    ;(map[r.product_name] ??= []).push(groupName)
  }
  return map
}

// ─── Interface pública ────────────────────────────────────────────────────────

export interface ClintLeads { total: number; interessado: number; abordado: number }

/**
 * Conta leads Clint por produto canônico no período.
 * Agora usa group.name do origin para identificar o produto,
 * contando todos os deals (não apenas os com tag específica).
 */
export async function fetchClintLeads(since: string, until: string): Promise<Record<string, ClintLeads>> {
  const token = process.env.CLINT_API_TOKEN ?? ''
  if (!token) return {}

  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

  try {
    const [origins, deals, groupsPorProduto] = await Promise.all([
      fetchOrigins(token),
      fetchAllDeals(token, since, until),
      fetchGroupsPorProduto(),
    ])

    // Agrupa deals por group.name do origin
    const byGroup: Record<string, { total: number; interessado: number; abordado: number }> = {}
    for (const deal of deals) {
      const origin = origins.get(deal.origin_id)
      if (!origin) continue
      const gName = origin.group.name
      if (!byGroup[gName]) byGroup[gName] = { total: 0, interessado: 0, abordado: 0 }
      byGroup[gName].total++
      const tipo = (deal.fields as { tipo?: string })?.tipo
      if (tipo) {
        const t = norm(tipo)
        if (t === 'interessado') byGroup[gName].interessado++
        else if (t === 'abordado') byGroup[gName].abordado++
      }
    }

    // Mapeia group.name → produto canônico
    const out: Record<string, ClintLeads> = {}
    for (const [produto, groupNames] of Object.entries(groupsPorProduto)) {
      let total = 0, interessado = 0, abordado = 0
      for (const gName of groupNames) {
        // Tenta match exato e por normalização
        const entry = byGroup[gName]
          ?? Object.entries(byGroup).find(([k]) => norm(k) === norm(gName))?.[1]
        if (entry) {
          total += entry.total
          interessado += entry.interessado
          abordado += entry.abordado
        }
      }
      if (total > 0) out[produto] = { total, interessado, abordado }
    }
    return out
  } catch (err) {
    console.error('fetchClintLeads error:', (err as Error).message)
    return {}
  }
}

// ─── Lista tags/grupos da Clint para o dropdown ──────────────────────────────

export async function fetchClintTagsList(): Promise<Array<{ id: string; name: string }>> {
  const token = process.env.CLINT_API_TOKEN ?? ''
  if (!token) return []
  try {
    const origins = await fetchOrigins(token)
    // Retorna grupos únicos (group.id + group.name) para o dropdown
    const grupos = new Map<string, string>()
    for (const o of origins.values()) {
      if (!o.archived_at) grupos.set(o.group.id, o.group.name)
    }
    return [...grupos.entries()]
      .map(([id, name]) => ({ id: name, name })) // id = name para facilitar mapeamento
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch { return [] }
}
