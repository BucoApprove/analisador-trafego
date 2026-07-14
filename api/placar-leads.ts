/**
 * Leads por produto canônico para a aba Placar:
 *   - leadsUtm:   leads únicos (BigQuery) cuja utm_campaign casa o prefixo do
 *                 produto na campaign_produto_map (mesma régua do gasto).
 *   - leadsClint: deals da Clint por tag do produto (api/_clint.ts).
 *   - leadsDistribuicao: breakdown por campanha + utm_content por produto.
 *   - leadsOrigem: leads pago vs orgânico por produto, a partir da tag do
 *                  produto no Green_Gold (green_gold_tags). "Pago" = lead com
 *                  essa tag cuja utm_campaign casa o prefixo do produto;
 *                  "orgânico" = demais leads com essa tag (sem UTM pago).
 *
 * GET /api/placar-leads?month=YYYY-MM
 * Retorna { leadsUtm, leadsClint, clintAtivo, leadsDistribuicao, leadsOrigem }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { bqQuery, tableLeads } from './_bq.js'
import { authUser, requireAdmin } from './_supabase-auth.js'
import { classifyProduto } from './_produtos-db.js'
import { fetchClintLeads } from './_clint.js'

interface Regra { prefixo: string; produtoCanonico: string }

function getSupabase() {
  return createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_KEY ?? '', {
    auth: { persistSession: false },
  })
}

async function fetchRegras(): Promise<Regra[]> {
  const sb = getSupabase()
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

interface TagRegra { tagName: string; produtoCanonico: string }

async function fetchTagRegras(): Promise<TagRegra[]> {
  const sb = getSupabase()
  const { data, error } = await sb.from('green_gold_tags').select('product_name, tag_name')
  if (error) throw new Error(`green_gold_tags: ${error.message}`)
  return (data ?? []).map(r => ({ tagName: String(r.tag_name), produtoCanonico: String(r.product_name) }))
}

export type LeadsDistRow = { campanha: string; content: string | null; leads: number }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await authUser(req, res); if (!user) return
  if (!requireAdmin(user, res)) return

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')

  const monthParam = typeof req.query.month === 'string' ? req.query.month : ''
  const now = new Date()
  const month = monthParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [y, m] = month.split('-').map(Number)
  const sinceParam = typeof req.query.since === 'string' ? req.query.since : ''
  const untilParam = typeof req.query.until === 'string' ? req.query.until : ''
  const rangeValido = !!(sinceParam && untilParam
    && sinceParam.slice(0, 7) === month && untilParam.slice(0, 7) === month
    && sinceParam <= untilParam)
  const since = rangeValido ? sinceParam : `${month}-01`
  const until = rangeValido ? untilParam : new Date(y, m, 0).toISOString().slice(0, 10)

  try {
    const [regras, tagRegras] = await Promise.all([fetchRegras(), fetchTagRegras()])
    const tLeads = tableLeads()
    const params = [{ name: 'since', value: since }, { name: 'until', value: until }]

    // Uma query com campanha + content — o total por produto é derivado somando.
    const sql = `
      SELECT
        utm_campaign,
        utm_content,
        COUNT(DISTINCT LOWER(TRIM(lead_email))) AS leads
      FROM ${tLeads}
      WHERE utm_campaign IS NOT NULL
        AND lead_email IS NOT NULL AND TRIM(lead_email) <> ''
        AND DATE(lead_register) >= @since
        AND DATE(lead_register) <= @until
      GROUP BY utm_campaign, utm_content
      ORDER BY leads DESC
    `

    // Leads por tag do produto (green_gold_tags), para separar pago vs orgânico.
    // "Pago" = tem utm_campaign casando o prefixo do produto; "orgânico" = resto
    // (sem UTM pago reconhecido, mesmo que tenha algum utm_campaign avulso).
    // bqQuery não suporta parâmetros array — as tags vêm do Supabase (admin-only,
    // não é input de usuário final), mas escapamos aspas simples por segurança.
    const tagNames = [...new Set(tagRegras.map(t => t.tagName))]
    const tagList = tagNames.map(t => `'${t.replace(/'/g, "\\'")}'`).join(', ')
    const tagSql = tagNames.length > 0 ? `
      SELECT
        tag_name,
        utm_campaign,
        COUNT(DISTINCT LOWER(TRIM(lead_email))) AS leads
      FROM ${tLeads}
      WHERE tag_name IN (${tagList})
        AND lead_email IS NOT NULL AND TRIM(lead_email) <> ''
        AND DATE(lead_register) >= @since
        AND DATE(lead_register) <= @until
      GROUP BY tag_name, utm_campaign
    ` : ''

    const [bqResult, leadsClint, tagResult] = await Promise.all([
      bqQuery(sql, params),
      fetchClintLeads(since, until),
      tagSql ? bqQuery(tagSql, params) : Promise.resolve({ rows: [] }),
    ])

    const leadsUtm: Record<string, number> = {}
    const leadsDistribuicao: Record<string, LeadsDistRow[]> = {}

    for (const row of bqResult.rows as Array<{ utm_campaign?: string; utm_content?: string; leads?: number }>) {
      const produto = matchProduto(row.utm_campaign ?? '', regras)
      if (!produto) continue
      const n = Number(row.leads ?? 0)
      leadsUtm[produto] = (leadsUtm[produto] ?? 0) + n
      ;(leadsDistribuicao[produto] ??= []).push({
        campanha: row.utm_campaign ?? '',
        content: row.utm_content ?? null,
        leads: n,
      })
    }

    const tagPorNome = new Map(tagRegras.map(t => [t.tagName, t.produtoCanonico]))
    const leadsOrigem: Record<string, { pago: number; organico: number }> = {}
    for (const row of tagResult.rows as Array<{ tag_name?: string; utm_campaign?: string; leads?: number }>) {
      const produto = tagPorNome.get(row.tag_name ?? '')
      if (!produto) continue
      const n = Number(row.leads ?? 0)
      const entry = (leadsOrigem[produto] ??= { pago: 0, organico: 0 })
      const ehPago = !!matchProduto(row.utm_campaign ?? '', regras)
      if (ehPago) entry.pago += n
      else entry.organico += n
    }

    res.json({ month, leadsUtm, leadsClint, clintAtivo: Object.keys(leadsClint).length > 0, leadsDistribuicao, leadsOrigem })
  } catch (err) {
    console.error('placar-leads error:', err)
    res.status(500).json({ error: 'Erro interno', detail: (err as Error).message })
  }
}
