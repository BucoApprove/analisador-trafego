/**
 * Endpoint temporário de diagnóstico da integração Clint.
 * REMOVER após corrigir o bug.
 *
 * GET /api/clint-debug?date=2026-07-06
 * Mostra: raw dos primeiros deals, formato do created_at, campos disponíveis,
 * e testa os endpoints de indicadores (novos interessados por produto).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authUser, requireAdmin } from './_supabase-auth.js'

const BASE = 'https://api.clint.digital'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await authUser(req, res); if (!user) return
  if (!requireAdmin(user, res)) return

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

  return res.json(out)
}
