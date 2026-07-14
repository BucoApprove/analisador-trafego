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
 *   1. Produtos com origem cadastrada (ex: Intensivo Enare como origem própria) →
 *      conta deals cujo origin_id bate, independente do grupo.
 *   2. Produtos com tag cadastrada (ex: Intensivo ENARE via tag legada) → conta deals
 *      que têm aquela tag, independente do grupo. Conta TODOS os deals (não só com fields.tipo).
 *   3. Produtos sem tag/origem (ex: Buco Approve via group "Buco Approve") → conta deals
 *      do grupo correspondente que NÃO têm nenhuma tag/origem de subproduto cadastrada.
 *   4. Outros grupos simples (Pós Anatomia, Mentoria, etc.) → todos os deals do grupo.
 *
 * Em todas as regras acima, deals cuja origem está em FUNIS_EXCLUIDOS (funis
 * pós-venda/operacionais: Compras aprovadas/expiradas/em aberto, Abandono de
 * carrinho, Reembolso/Chargeback, Cartão recusado, Falar em data futura) são
 * descartados — são o mesmo negócio recriado em outro estágio, não leads novos.
 *
 * Configuração em clint_tags (Supabase):
 *   - product_name = nome canônico do produto no Placar
 *   - tag_id       = um dos três formatos abaixo (diferenciados pelo próprio valor,
 *                    não há coluna de tipo separada):
 *                      - "origin:<uuid>"               → origem exclusiva da Clint
 *                      - UUID puro (xxxxxxxx-xxxx-...)  → tag real da Clint
 *                      - qualquer outra string           → nome do grupo
 *   - label        = nome legível, só para exibição
 */
import { createClient } from '@supabase/supabase-js'

const BASE = 'https://api.clint.digital'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ORIGIN_PREFIX = 'origin:'

function isUuid(s: string) { return UUID_RE.test(s) }
function isOriginRef(s: string) { return s.startsWith(ORIGIN_PREFIX) && isUuid(s.slice(ORIGIN_PREFIX.length)) }
function originIdOf(s: string) { return s.slice(ORIGIN_PREFIX.length) }

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
  contact?: { name?: string; phone?: string; email?: string }
  user?: { full_name?: string }
  stage?: string
}

export interface ClintDealDetail {
  id: string
  date: string        // YYYY-MM-DD em horário Brasília
  name: string
  phone: string | null
  tipo: 'Interessado' | 'Abordado' | null
  funil: string
  stage: string
  vendedor: string | null
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

// Data (YYYY-MM-DD) de um created_at (ISO UTC) em horário de Brasília — mesma
// conversão usada na exibição (ClintDealDetail.date), para o filtro de busca
// nunca divergir do que é mostrado na tela.
function dateBrasilia(createdAtUtc: string): string {
  return new Date(new Date(createdAtUtc).getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// Busca deals num range ampliado (±1 dia de margem, cobre qualquer offset de
// timezone que a Clint use para interpretar created_at_start/end — não está
// documentado/confirmado) e filtra no nosso lado pela data em horário de
// Brasília, para o range buscado bater exatamente com o range exibido.
async function fetchAllDeals(token: string, since: string, until: string): Promise<ClintDeal[]> {
  const all: ClintDeal[] = []
  const sinceMargin = new Date(`${since}T00:00:00Z`)
  sinceMargin.setUTCDate(sinceMargin.getUTCDate() - 1)
  const untilMargin = new Date(`${until}T00:00:00Z`)
  untilMargin.setUTCDate(untilMargin.getUTCDate() + 1)
  const sinceParam = sinceMargin.toISOString().slice(0, 10)
  const untilParam = `${untilMargin.toISOString().slice(0, 10)}T23:59:59`
  let page = 1
  for (let i = 0; i < 200; i++) {
    const u = new URL(`${BASE}/v1/deals`)
    u.searchParams.set('limit', '100')
    u.searchParams.set('page', String(page))
    u.searchParams.set('created_at_start', sinceParam)
    u.searchParams.set('created_at_end', untilParam)
    const r = await fetch(u.toString(), { headers: { 'api-token': token, Accept: 'application/json' } })
    if (!r.ok) throw new Error(`Clint /v1/deals ${r.status}`)
    const j = body2json(await r.text()) as { data?: ClintDeal[]; hasNext?: boolean }
    all.push(...(j.data ?? []))
    if (!j.hasNext || (j.data ?? []).length === 0) break
    page++
  }
  // Filtra pela data real em horário de Brasília — garante que o que foi
  // buscado bate exatamente com [since, until], independente de qual
  // timezone a Clint usou para interpretar created_at_start/end.
  return all.filter(d => {
    const date = dateBrasilia(d.created_at)
    return date >= since && date <= until
  })
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

// Origens (funis) pós-venda/operacionais da Clint — não são leads novos, são o
// mesmo negócio recriado em outro estágio do funil comercial (ex.: um deal que
// vira "Compras aprovadas" ao fechar, ou "Cartão recusado" quando o pagamento
// falha). Contar essas origens infla a contagem de leads com deals duplicados.
// Excluídas em toda contagem (por tag, origem exclusiva ou grupo).
const FUNIS_EXCLUIDOS = new Set([
  'Compras aprovadas',
  'Compras expiradas',
  'Compras em aberto',
  'Abandono de carrinho',
  'Reembolso/Chargeback',
  'Cartão recusado',
  'Falar em data futura',
].map(norm))

function isFunilComercial(originName: string): boolean {
  return !FUNIS_EXCLUIDOS.has(norm(originName))
}

// Replica a lógica do painel "Novos interessados" da Clint:
//   - total     = deals com tipo != "Abordado" (inclui vazio, "Interessado", outros)
//   - interessado = deals com tipo == "Interessado" explícito
//   - abordado   = deals com tipo == "Abordado"
// O painel exclui "Compras aprovadas" e conta os demais exceto os marcados como Abordado.
function countTipo(deals: ClintDeal[]): { total: number; interessado: number; abordado: number } {
  let interessado = 0, abordado = 0
  for (const d of deals) {
    const tipo = norm((d.fields?.tipo as string | undefined) ?? '')
    if (tipo === 'abordado') abordado++
    else if (tipo === 'interessado') interessado++
    // vazio ou outro tipo = conta no total mas não em nenhuma subcategoria
  }
  // total = todos exceto abordados (replica filtro do painel Clint)
  const total = deals.length - abordado
  return { total, interessado, abordado }
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

    // Separa config em: origin-based ("origin:<uuid>") vs tag-based (UUID) vs group-based (string livre)
    const originRows = config.filter(r => isOriginRef(r.tag_id))
    const tagRows = config.filter(r => !isOriginRef(r.tag_id) && isUuid(r.tag_id))
    const groupRows = config.filter(r => !isOriginRef(r.tag_id) && !isUuid(r.tag_id))

    // 0. Para cada produto com origem exclusiva: conta deals daquele origin_id
    //    Também entra no set "excluído dos grupos", igual às tags.
    const tagDealIds = new Set<string>() // todos os IDs já atribuídos por origem ou tag de subproduto
    const out: Record<string, ClintLeads> = {}

    for (const row of originRows) {
      const originId = originIdOf(row.tag_id)
      const dealsDestaOrigem = allDeals.filter(d => d.origin_id === originId)
        .filter(d => {
          const origin = origins.get(d.origin_id)
          return !origin || isFunilComercial(origin.name)
        })
      const prev = out[row.product_name] ?? { total: 0, interessado: 0, abordado: 0 }
      const counts = countTipo(dealsDestaOrigem)
      out[row.product_name] = {
        total: prev.total + counts.total,
        interessado: prev.interessado + counts.interessado,
        abordado: prev.abordado + counts.abordado,
      }
      for (const d of dealsDestaOrigem) tagDealIds.add(d.id)
    }

    // 1. Para cada produto com tag: busca deals pela tag
    //    Coleta também o set de deal IDs que pertencem a alguma tag
    //    (para excluir do produto "pai" de grupo)
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
      // Exclui deals já contados por origem exclusiva (evita duplicar quando o
      // mesmo deal tem tag legada E pertence à origem nova do mesmo produto) e
      // deals em funis pós-venda/operacionais (duplicatas do mesmo negócio).
      const dealsDestaTag = allDeals.filter(d => {
        if (!ids.has(d.id) || tagDealIds.has(d.id)) return false
        const origin = origins.get(d.origin_id)
        return !origin || isFunilComercial(origin.name)
      })
      const counts = countTipo(dealsDestaTag)
      out[row.product_name] = {
        total: prev.total + counts.total,
        interessado: prev.interessado + counts.interessado,
        abordado: prev.abordado + counts.abordado,
      }
      // Marca esses IDs como "pertencentes a subproduto com tag"
      for (const id of ids) tagDealIds.add(id)
    }

    // 2. Para produtos mapeados por group.name: conta deals do grupo
    //    excluindo os que já têm origem/tag de subproduto e funis operacionais
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
// Retorna tags reais (UUID), origens exclusivas ("origin:<uuid>") e grupos como
// opções configuráveis

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

    // Origens (funis individuais) e grupos (produtos), ambos a partir de /v1/origins
    const origins = await fetchOrigins(token)
    const grupos = new Map<string, string>()
    const origensOut: Array<{ id: string; name: string }> = []
    for (const o of origins.values()) {
      if (o.archived_at) continue
      grupos.set(o.group.name, o.group.name)
      origensOut.push({
        id: `${ORIGIN_PREFIX}${o.id}`,
        name: `[Origem] ${o.name} (${o.group.name})`,
      })
    }
    const gruposOut = [...grupos.entries()].map(([name]) => ({
      id: name, // id = nome do grupo (identificador para a lógica de group-based)
      name: `[Grupo] ${name}`,
    }))

    return [...tagsOut, ...origensOut, ...gruposOut].sort((a, b) => a.name.localeCompare(b.name))
  } catch { return [] }
}

// ─── Detalhes dos deals de um produto (para o modal) ─────────────────────────

export async function fetchClintLeadsDetalhados(
  since: string,
  until: string,
  produto: string,
): Promise<ClintDealDetail[]> {
  const token = process.env.CLINT_API_TOKEN ?? ''
  if (!token) return []

  const [config, origins, allDeals] = await Promise.all([
    fetchConfig(),
    fetchOrigins(token),
    fetchAllDeals(token, since, until),
  ])

  const originRows = config.filter(r => r.product_name === produto && isOriginRef(r.tag_id))
  const tagRows = config.filter(r => r.product_name === produto && !isOriginRef(r.tag_id) && isUuid(r.tag_id))
  const groupRows = config.filter(r => r.product_name === produto && !isOriginRef(r.tag_id) && !isUuid(r.tag_id))

  // IDs dos deals por origem exclusiva
  const originIds = new Set(originRows.map(r => originIdOf(r.tag_id)))

  // IDs dos deals por tag
  const tagDealIds = new Set<string>()
  if (tagRows.length > 0) {
    const tagResults = await Promise.all(tagRows.map(r => fetchDealsByTag(token, r.tag_id, since, until)))
    for (const ids of tagResults) for (const id of ids) tagDealIds.add(id)
  }

  // Todos os IDs de origem/tag de subprodutos (para excluir dos deals de grupo)
  const allOriginIds = new Set(config.filter(r => isOriginRef(r.tag_id)).map(r => originIdOf(r.tag_id)))
  const allTagConfig = config.filter(r => !isOriginRef(r.tag_id) && isUuid(r.tag_id))
  const allSubTagIds = new Set<string>()
  if (allTagConfig.length > 0) {
    const all = await Promise.all(allTagConfig.map(r => fetchDealsByTag(token, r.tag_id, since, until)))
    for (const ids of all) for (const id of ids) allSubTagIds.add(id)
  }

  // Filtra os deals do produto
  const dealsDoP = allDeals.filter(d => {
    const origin = origins.get(d.origin_id)
    if (origin && !isFunilComercial(origin.name)) return false
    if (originRows.length > 0 || tagRows.length > 0) {
      return originIds.has(d.origin_id) || tagDealIds.has(d.id)
    }
    if (!origin) return false
    return groupRows.some(r => norm(origin.group.name) === norm(r.tag_id))
      && !allOriginIds.has(d.origin_id)
      && !allSubTagIds.has(d.id)
  })

  return dealsDoP
    .map(d => {
      const tipo = norm((d.fields?.tipo as string | undefined) ?? '')
      const origin = origins.get(d.origin_id)
      return {
        id: d.id,
        date: dateBrasilia(d.created_at),
        name: d.contact?.name ?? '—',
        phone: d.contact?.phone ?? null,
        tipo: tipo === 'interessado' ? 'Interessado' : tipo === 'abordado' ? 'Abordado' : null,
        funil: origin?.name ?? '—',
        stage: d.stage ?? '—',
        vendedor: d.user?.full_name ?? null,
      } satisfies ClintDealDetail
    })
    .sort((a, b) => b.date.localeCompare(a.date))
}
