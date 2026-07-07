/**
 * Endpoint temporário de diagnóstico da integração Clint.
 * REMOVER após corrigir o bug.
 *
 * GET /api/clint-debug?date=2026-07-06
 * Mostra: raw dos primeiros deals, formato do created_at, campos disponíveis,
 * e testa os endpoints de indicadores (novos interessados por produto).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authUser } from './_supabase-auth.js'

const BASE = 'https://api.clint.digital'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Aceita skill key (para chamar direto pela URL) ou sessão normal
  const skillKey = process.env.PLACAR_SKILL_KEY ?? ''
  const providedKey = typeof req.query.key === 'string' ? req.query.key : ''
  const hasSkillKey = skillKey && providedKey === skillKey
  if (!hasSkillKey) {
    const user = await authUser(req, res); if (!user) return
  }

  const token = process.env.CLINT_API_TOKEN ?? ''
  if (!token) return res.status(500).json({ error: 'CLINT_API_TOKEN não configurado' })

  const date = typeof req.query.date === 'string' ? req.query.date : new Date().toISOString().slice(0, 10)
  const headers = { 'api-token': token, Accept: 'application/json' }
  const out: Record<string, unknown> = { date }

  // 1. Primeiros 5 deals sem filtro de data (ver formato bruto)
  try {
    const u = new URL(`${BASE}/v1/deals`)
    u.searchParams.set('limit', '5')
    u.searchParams.set('page', '1')
    const r = await fetch(u.toString(), { headers })
    const j = await r.json()
    out.deals_raw_sample = j
  } catch (e) { out.deals_raw_error = (e as Error).message }

  // 2. Deals com filtro de data exato (como o placar usa)
  try {
    const u = new URL(`${BASE}/v1/deals`)
    u.searchParams.set('limit', '10')
    u.searchParams.set('page', '1')
    u.searchParams.set('created_at_start', date)
    u.searchParams.set('created_at_end', `${date}T23:59:59`)
    const r = await fetch(u.toString(), { headers })
    const j = await r.json()
    out.deals_with_date_filter = j
  } catch (e) { out.deals_with_date_filter_error = (e as Error).message }

  // 3. Testar endpoint de indicadores (o que o painel usa)
  const indicadorEndpoints = [
    `/v1/indicators`,
    `/v1/dashboard`,
    `/v1/reports`,
    `/v1/reports/deals`,
    `/v1/analytics`,
  ]
  out.indicators_probe = {}
  for (const path of indicadorEndpoints) {
    try {
      const u = new URL(`${BASE}${path}`)
      u.searchParams.set('start_date', date)
      u.searchParams.set('end_date', date)
      const r = await fetch(u.toString(), { headers })
      ;(out.indicators_probe as Record<string, unknown>)[path] = {
        status: r.status,
        body: r.status < 400 ? await r.json() : await r.text().then(t => t.slice(0, 200)),
      }
    } catch (e) {
      ;(out.indicators_probe as Record<string, unknown>)[path] = { error: (e as Error).message }
    }
  }

  // 4. Listar campos disponíveis nos deals (quais fields existem)
  try {
    const u = new URL(`${BASE}/v1/deals/fields`)
    const r = await fetch(u.toString(), { headers })
    out.deal_fields = r.ok ? await r.json() : { status: r.status }
  } catch (e) { out.deal_fields_error = (e as Error).message }

  // 5. Deals do dia com campo fields expandido
  try {
    const u = new URL(`${BASE}/v1/deals`)
    u.searchParams.set('limit', '5')
    u.searchParams.set('page', '1')
    u.searchParams.set('created_at_start', date)
    u.searchParams.set('created_at_end', `${date}T23:59:59`)
    u.searchParams.set('expand', 'fields')
    const r = await fetch(u.toString(), { headers })
    out.deals_with_expand = r.ok ? await r.json() : { status: r.status }
  } catch (e) { out.deals_with_expand_error = (e as Error).message }

  // 6. Listar funis/origens (para mapear origin_id → produto)
  const originEndpoints = ['/v1/funnels', '/v1/origins', '/v1/pipelines', '/v1/sources']
  out.origins_probe = {}
  for (const path of originEndpoints) {
    try {
      const r = await fetch(`${BASE}${path}`, { headers })
      ;(out.origins_probe as Record<string, unknown>)[path] = {
        status: r.status,
        body: r.ok ? await r.json() : (await r.text()).slice(0, 100),
      }
    } catch (e) {
      ;(out.origins_probe as Record<string, unknown>)[path] = { error: (e as Error).message }
    }
  }

  // 7. Contagem por origin_id no dia (sem filtro de tag)
  try {
    const allDeals: Array<{ origin_id: string; fields: Record<string, string>; stage: string }> = []
    for (let page = 1; page <= 10; page++) {
      const u = new URL(`${BASE}/v1/deals`)
      u.searchParams.set('limit', '100')
      u.searchParams.set('page', String(page))
      u.searchParams.set('created_at_start', date)
      u.searchParams.set('created_at_end', `${date}T23:59:59`)
      const r = await fetch(u.toString(), { headers })
      const j = await r.json() as { data?: typeof allDeals; hasNext?: boolean; totalCount?: number }
      if (page === 1) out.total_deals_no_tag_filter = j.totalCount
      allDeals.push(...(j.data ?? []))
      if (!j.hasNext) break
    }
    // Agrupa por origin_id
    const byOrigin: Record<string, { total: number; comTipo: number; stages: Record<string, number> }> = {}
    for (const d of allDeals) {
      const o = d.origin_id ?? 'sem-origin'
      if (!byOrigin[o]) byOrigin[o] = { total: 0, comTipo: 0, stages: {} }
      byOrigin[o].total++
      if (d.fields?.tipo) byOrigin[o].comTipo++
      byOrigin[o].stages[d.stage] = (byOrigin[o].stages[d.stage] ?? 0) + 1
    }
    out.deals_by_origin = byOrigin
    out.total_fetched = allDeals.length
  } catch (e) { out.deals_by_origin_error = (e as Error).message }

  // 8. Buscar deals por tag específica (ex: rte_intensivo) para ver estrutura
  // Pega a primeira tag cadastrada no Supabase para testar
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const sb = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_KEY ?? '', { auth: { persistSession: false } })
    const { data: tags } = await sb.from('clint_tags').select('tag_id, label, product_name').limit(3)
    out.clint_tags_cadastradas = tags

    if (tags && tags.length > 0) {
      const tagId = tags[0].tag_id
      const u = new URL(`${BASE}/v1/deals`)
      u.searchParams.set('tag_ids', tagId)
      u.searchParams.set('limit', '3')
      u.searchParams.set('page', '1')
      const r = await fetch(u.toString(), { headers })
      const j = await r.json()
      out.deals_por_tag_sample = { tag_id: tagId, label: tags[0].label, product: tags[0].product_name, result: j }
    }
  } catch (e) { out.tag_test_error = (e as Error).message }

  // 9. Contagem por funil (origin.name) dentro do grupo Buco Approve — julho inteiro
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const sb = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_KEY ?? '', { auth: { persistSession: false } })

    // Busca origens
    const origR = await fetch(`${BASE}/v1/origins?limit=200&page=1`, { headers })
    const origJ = await origR.json() as { data?: Array<{ id: string; name: string; group: { name: string }; archived_at: string | null }> }
    const origins = new Map((origJ.data ?? []).map(o => [o.id, o]))

    // Busca todos os deals de julho até hoje
    const allDeals: Array<{ id: string; origin_id: string; created_at: string }> = []
    for (let p = 1; p <= 20; p++) {
      const u = new URL(`${BASE}/v1/deals`)
      u.searchParams.set('limit', '100')
      u.searchParams.set('page', String(p))
      u.searchParams.set('created_at_start', '2026-07-01')
      u.searchParams.set('created_at_end', '2026-07-07T23:59:59')
      const r = await fetch(u.toString(), { headers })
      const j = await r.json() as { data?: typeof allDeals; hasNext?: boolean }
      allDeals.push(...(j.data ?? []))
      if (!j.hasNext) break
    }

    // Agrupa por funil dentro do grupo Buco Approve
    const porFunil: Record<string, number> = {}
    for (const d of allDeals) {
      const o = origins.get(d.origin_id)
      if (!o || o.group.name !== 'Buco Approve') continue
      porFunil[o.name] = (porFunil[o.name] ?? 0) + 1
    }
    out.buco_por_funil = { total_deals: allDeals.filter(d => origins.get(d.origin_id)?.group.name === 'Buco Approve').length, por_funil: porFunil }
  } catch (e) { out.buco_por_funil_error = (e as Error).message }

  return res.json(out)
}
