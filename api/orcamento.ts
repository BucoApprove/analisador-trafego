/**
 * GET  /api/orcamento?month=YYYY-MM  → { produtos: Record<string, OrcamentoEntry> }
 * POST /api/orcamento                → body: { month, product, orcamento?, ticket?, conversao? }
 *
 * Tabela Supabase `orcamento_trafego`:
 *   month TEXT, product TEXT, orcamento NUMERIC, ticket NUMERIC, conversao NUMERIC
 *   PK: (month, product)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { authUser } from './_supabase-auth.js'

function serviceClient() {
  return createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_KEY ?? '',
    { auth: { persistSession: false } },
  )
}

export interface OrcamentoEntry {
  orcamento: number | null
  ticket: number | null
  conversao: number | null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await authUser(req, res); if (!user) return
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'GET') {
    const month = typeof req.query.month === 'string' ? req.query.month : ''
    if (!month) return res.status(400).json({ error: 'month is required' })

    const sb = serviceClient()
    const { data, error } = await sb
      .from('orcamento_trafego')
      .select('product, orcamento, ticket, conversao')
      .eq('month', month)
    if (error) return res.status(500).json({ error: error.message })

    const produtos: Record<string, OrcamentoEntry> = {}
    for (const r of data ?? []) {
      produtos[r.product] = {
        orcamento: r.orcamento != null ? Number(r.orcamento) : null,
        ticket: r.ticket != null ? Number(r.ticket) : null,
        conversao: r.conversao != null ? Number(r.conversao) : null,
      }
    }
    return res.json({ produtos })
  }

  if (req.method === 'POST') {
    const body = req.body as { month?: string; product?: string; orcamento?: number | null; ticket?: number | null; conversao?: number | null }
    const { month, product } = body
    if (!month || !product) return res.status(400).json({ error: 'month and product are required' })

    const sb = serviceClient()
    const { error } = await sb.from('orcamento_trafego').upsert({
      month,
      product,
      orcamento: body.orcamento ?? null,
      ticket: body.ticket ?? null,
      conversao: body.conversao ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'month,product' })
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
