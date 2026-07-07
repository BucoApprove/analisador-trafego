/**
 * Integração com a Clint (CRM) — contagem de leads (deals) por produto.
 *
 * Lógica de atribuição (descoberta via debug 2026-07-07):
 *
 * A Clint organiza deals em "origens" (funis) que pertencem a "grupos" (produto).
 * O painel "Novos interessados" conta todos os deals criados no período por grupo.
 *
 * Problema: Intensivo ENARE e Buco Approve vivem no mesmo grupo "Buco Approve".
 * A distinção é feita via tag da Clint (cadastrada em clint_tags no Supabase).
 *
 * Regras de atribuição (em ordem de prioridade):
 *   1. Produtos com tag cadastrada (ex: Intensivo ENARE) → conta deals que têm
 *      aquela tag, independente do grupo. Conta TODOS os deals (não só com fields.tipo).
 *   2. Produtos sem tag (ex: Buco Approve via group "Buco Approve") → conta deals
 *      do grupo correspondente que NÃO têm nenhuma tag de subproduto cadastrada.
 *   3. Outros grupos simples (Pós Anatomia, Mentoria, etc.) → todos os deals do grupo.
 *
 * Configuração em clint_tags (Supabase):
 *   - product_name = nome canônico do produto no Placar
 *   - tag_id       = UUID da tag na Clint (para subprodutos com tag)
 *                    OU nome do grupo (para produtos mapeados por grupo)
 *   - label        = nome legível (usado para identificar se é grupo ou tag)
 *   - is_group     = se true, é mapeamento por group.name; se false/null, é tag UUID
 *
 * Como não há campo is_group ainda, diferenciamos pelo formato do tag_id:
 *   - UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) → tag real da Clint
 *   - qualquer outra string → nome de grupo
 */
import { createClient } from '@supabase/supabase-js'

const BASE = 'https://api.clint.digital'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(s: string) { return UUID_RE.test(s) }

function body2json(body: string): unknown {
  try { return body ? JSON.parse(body) : {} } catch { return {} }
}

// ─── Tipos da API ─────────────────────────────────────────────────────────────

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
  fields: Record<string, unknown>
}

// ─── Cache de origens ─────────────────────────────────────────────────────────

let _originsCache: { map: Map<string, ClintOrigin>; ts: number } | null = null
const CACHE_TTL = 10 * 60 * 1000

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

// ─── Busca deals por tag (subprodutos) ───────────────────────────────────────

async function fetchDealsByTag(token: string, tagId: string, since: string, until: string): Promise<Set<string>> {
  const ids = new Set<string>()
  const untilEod = `${until}T23:59:59`
  let page = 1
  for (let i = 0; i < 200; i++) {
    const u = new URL(`${BASE}/v1/deals`)
    u.searchParams.set('tag_ids', tagId)
    u.searchParams.set('created_at_start', since)
    u.searchParams.set('created_at_end', untilEod)
    u.searchParams.set('limit', '100')
    u.searchParams.set('page', String(page))
    const r = await fetch(u.toString(), { headers: { 'api-token': token, Accept: 'application/json' } })
    if (!r.ok) throw new Error(`Clint /v1/deals (tag) ${r.status}`)
    const j = body2json(await r.text()) as { data?: ClintDeal[]; hasNext?: boolean }
    for (const d of j.data ?? []) if (d.id) ids.add(d.id)
    if (!j.hasNext || (j.data ?? []).length === 0) break
    page++
  }
  return ids
}

// ─── Busca todos os deals do período ─────────────────────────────────────────

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
    all.push(...(j.data ?? []))
    if (!j.hasNext || (j.data ?? []).length === 0) break
    page++
  }
  return all
}

// ─── Lê configuração do Supabase ─────────────────────────────────────────────

interface ClintTagRow { product_name: string; tag_id: string; label: string }

async function fetchConfig(): Promise<ClintTagRow[]> {
  const sb = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_KEY ?? '', {
    auth: { persistSession: false },
  })
  const { data, error } = await sb.from('clint_tags').select('product_name, tag_id, label')
  if (error) throw new Error(`clint_tags: ${error.message}`)
  return (data ?? []).filter(r => r.product_name && r.tag_id)
}

// ─── Interface pública ────────────────────────────────────────────────────────

export interface ClintLeads { total: number; interessado: number; abordado: number }

function norm(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

function countTipo(deals: ClintDeal[]): { total: number; interessado: number; abordado: number } {
  let interessado = 0, abordado = 0
  for (const d of deals) {
    const tipo = (d.fields?.tipo as string | undefined) ?? ''
    if (tipo) {
      const t = norm(tipo)
      if (t === 'interessado') interessado++
      else if (t === 'abordado') abordado++
    }
  }
  return { total: deals.length, interessado, abordado }
}

export async function fetchClintLeads(since: string, until: string): Promise<Record<string, ClintLeads>> {
  const token = process.env.CLINT_API_TOKEN ?? ''
  if (!token) return {}

  try {
    const [config, origins, allDeals] = await Promise.all([
      fetchConfig(),
      fetchOrigins(token),
      fetchAllDeals(token, since, until),
    ])

    // Separa config em: tag-based (UUID) vs group-based (string livre)
    const tagRows = config.filter(r => isUuid(r.tag_id))
    const groupRows = config.filter(r => !isUuid(r.tag_id))

    // 1. Para cada produto com tag: busca deals pela tag
    //    Coleta também o set de deal IDs que pertencem a alguma tag
    //    (para excluir do produto "pai" de grupo)
    const tagDealIds = new Set<string>() // todos os IDs que têm qualquer tag de subproduto
    const out: Record<string, ClintLeads> = {}

    // Busca por tag em paralelo
    const tagResults = await Promise.all(
      tagRows.map(async row => {
        const ids = await fetchDealsByTag(token, row.tag_id, since, until)
        return { row, ids }
      })
    )

    for (const { row, ids } of tagResults) {
      // Acumula por produto (pode haver múltiplas tags para o mesmo produto)
      const prev = out[row.product_name] ?? { total: 0, interessado: 0, abordado: 0 }
      // Pega os deals completos para contar tipo
      const dealsDestaTag = allDeals.filter(d => ids.has(d.id))
      const counts = countTipo(dealsDestaTag)
      out[row.product_name] = {
        total: prev.total + counts.total,
        interessado: prev.interessado + counts.interessado,
        abordado: prev.abordado + counts.abordado,
      }
      // Marca esses IDs como "pertencentes a subproduto com tag"
      for (const id of ids) tagDealIds.add(id)
    }

    // Funis operacionais/pós-venda que não devem contar como leads comerciais
    const FUNIS_EXCLUIDOS = [
      'compras aprovadas', 'compras em aberto', 'compras expiradas',
      'cartao recusado', 'cartão recusado', 'reembolso', 'chargeback',
      'boletos', 'upsell', 'lista de espera',
    ]
    function isFunilComercial(originName: string): boolean {
      const n = norm(originName)
      return !FUNIS_EXCLUIDOS.some(ex => n.includes(norm(ex)))
    }

    // 2. Para produtos mapeados por group.name: conta deals do grupo
    //    excluindo os que já têm tag de subproduto e funis operacionais
    for (const row of groupRows) {
      const groupName = row.tag_id // aqui tag_id é o nome do grupo
      const dealsDoGrupo = allDeals.filter(d => {
        const origin = origins.get(d.origin_id)
        if (!origin) return false
        return norm(origin.group.name) === norm(groupName)
          && !tagDealIds.has(d.id)
          && isFunilComercial(origin.name)
      })
      if (dealsDoGrupo.length === 0) continue
      const prev = out[row.product_name] ?? { total: 0, interessado: 0, abordado: 0 }
      const counts = countTipo(dealsDoGrupo)
      out[row.product_name] = {
        total: prev.total + counts.total,
        interessado: prev.interessado + counts.interessado,
        abordado: prev.abordado + counts.abordado,
      }
    }

    return out
  } catch (err) {
    console.error('fetchClintLeads error:', (err as Error).message)
    return {}
  }
}

// ─── Lista disponível para o dropdown da UI ───────────────────────────────────
// Retorna tanto as tags reais (UUID) quanto os grupos como opções configuráveis

export async function fetchClintTagsList(): Promise<Array<{ id: string; name: string }>> {
  const token = process.env.CLINT_API_TOKEN ?? ''
  if (!token) return []
  try {
    // Tags da Clint (para subprodutos)
    const tagsOut: Array<{ id: string; name: string }> = []
    let page = 1
    for (let i = 0; i < 20; i++) {
      const u = new URL(`${BASE}/v1/tags`)
      u.searchParams.set('limit', '100')
      u.searchParams.set('page', String(page))
      const r = await fetch(u.toString(), { headers: { 'api-token': token, Accept: 'application/json' } })
      if (!r.ok) break
      const j = body2json(await r.text()) as { data?: Array<{ id?: string; name?: string }>; hasNext?: boolean }
      for (const t of j.data ?? []) if (t.id) tagsOut.push({ id: t.id, name: t.name ?? t.id })
      if (!j.hasNext || (j.data ?? []).length === 0) break
      page++
    }

    // Grupos (para produtos mapeados por grupo)
    const origins = await fetchOrigins(token)
    const grupos = new Map<string, string>()
    for (const o of origins.values()) {
      if (!o.archived_at) grupos.set(o.group.name, o.group.name)
    }
    const gruposOut = [...grupos.entries()].map(([name]) => ({
      id: name, // id = nome do grupo (identificador para a lógica de group-based)
      name: `[Grupo] ${name}`,
    }))

    return [...tagsOut, ...gruposOut].sort((a, b) => a.name.localeCompare(b.name))
  } catch { return [] }
}
