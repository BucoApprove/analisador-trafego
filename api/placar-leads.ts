/**
 * Leads por produto canônico para a aba Placar:
 *   - leadsUtm:   leads únicos (BigQuery) cuja utm_campaign casa o prefixo do
 *                 produto na campaign_produto_map (mesma régua do gasto).
 *   - leadsClint: deals da Clint por tag do produto (api/_clint.ts).
 *
 * GET /api/placar-leads?month=YYYY-MM
 * Retorna { leadsUtm: {nome: n}, leadsClint: {nome: n}, clintAtivo: bool }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { bqQuery, tableLeads } from './_bq.js'
import { authUser, requireAdmin } from './_supabase-auth.js'
import { classifyProduto } from './_produtos-db.js'
import { fetchClintLeads } from './_clint.js'

interface Regra { prefixo: string; produtoCanonico: string }

async function fetchRegras(): Promise<Regra[]> {
  const sb = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_KEY ?? '', {
    auth: { persistSession: false },
  })
  // Lê todas as contas (o gasto é por conta, mas o lead casa só pelo nome da campanha).
  const { data, error } = await sb.from('campaign_produto_map').select('prefixo, produto_ids')
  if (error) throw new Error(`campaign_produto_map: ${error.message}`)
  const regras: Regra[] = []
  for (const r of data ?? []) {
    const ids = (r.produto_ids as number[]) ?? []
    if (ids.length === 0 || !r.prefixo) continue
    const canon = await classifyProduto(Number(ids[0]))
    regras.push({ prefixo: String(r.prefixo).toLowerCase().trim(), produtoCanonico: canon.nome })
  }
  return regras.sort((a, b) => b.prefixo.length - a.prefixo.length)
}

function matchProduto(campaign: string, regras: Regra[]): string | null {
  const n = (campaign ?? '').toLowerCase()
  for (const r of regras) {
    if (r.prefixo && n.includes(r.prefixo)) return r.produtoCanonico
  }
  return null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await authUser(req, res); if (!user) return
  if (!requireAdmin(user, res)) return

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')

  const monthParam = typeof req.query.month === 'string' ? req.query.month : ''
  const now = new Date()
  const month = monthParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [y, m] = month.split('-').map(Number)
  // Range opcional (since/until) dentro do mês — sobrescreve o mês inteiro.
  const sinceParam = typeof req.query.since === 'string' ? req.query.since : ''
  const untilParam = typeof req.query.until === 'string' ? req.query.until : ''
  const rangeValido = !!(sinceParam && untilParam
    && sinceParam.slice(0, 7) === month && untilParam.slice(0, 7) === month
    && sinceParam <= untilParam)
  const since = rangeValido ? sinceParam : `${month}-01`
  const until = rangeValido ? untilParam : new Date(y, m, 0).toISOString().slice(0, 10)

  try {
    const regras = await fetchRegras()

    // Leads UTM: distinct lead_email por utm_campaign no período.
    const tLeads = tableLeads()
    const sql = `
      SELECT utm_campaign, COUNT(DISTINCT LOWER(TRIM(lead_email))) AS leads
      FROM ${tLeads}
      WHERE utm_campaign IS NOT NULL
        AND lead_email IS NOT NULL AND TRIM(lead_email) <> ''
        AND DATE(lead_register) >= @since
        AND DATE(lead_register) <= @until
      GROUP BY utm_campaign
    `
    const bqResult = await bqQuery(sql, [
      { name: 'since', value: since },
      { name: 'until', value: until },
    ])

    const leadsUtm: Record<string, number> = {}
    for (const row of bqResult.rows as Array<{ utm_campaign?: string; leads?: number }>) {
      const produto = matchProduto(row.utm_campaign ?? '', regras)
      if (!produto) continue
      leadsUtm[produto] = (leadsUtm[produto] ?? 0) + Number(row.leads ?? 0)
    }

    // Leads Clint (vazio se token não configurado).
    const leadsClint = await fetchClintLeads(since, until)

    res.json({ month, leadsUtm, leadsClint, clintAtivo: Object.keys(leadsClint).length > 0 })
  } catch (err) {
    console.error('placar-leads error:', err)
    res.status(500).json({ error: 'Erro interno', detail: (err as Error).message })
  }
}
