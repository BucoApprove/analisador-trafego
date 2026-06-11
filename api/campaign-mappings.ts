/**
 * CRUD do matching campanha → produto (aba Placar).
 *
 * GET    → lista todas as regras (keyword → product_name)
 * POST   → cria/atualiza uma regra { keyword, product_name }
 * DELETE → remove uma regra (?keyword=...)
 *
 * Admin-only. RLS off (acesso controlado pelo Bearer).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { authUser, requireAdmin } from './_supabase-auth.js'

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_KEY ?? '',
    { auth: { persistSession: false } },
  )
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await authUser(req, res); if (!user) return
  if (!requireAdmin(user, res)) return

  const sb = getSupabase()

  if (req.method === 'GET') {
    const { data, error } = await sb
      .from('campaign_mappings')
      .select('keyword, product_name')
      .order('keyword')
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ mappings: data ?? [] })
  }

  if (req.method === 'POST') {
    const keyword = String(req.body?.keyword ?? '').toLowerCase().trim()
    const productName = String(req.body?.product_name ?? '').trim()
    if (!keyword || !productName) {
      return res.status(400).json({ error: 'keyword e product_name são obrigatórios' })
    }
    const { error } = await sb.from('campaign_mappings').upsert(
      { keyword, product_name: productName, updated_at: new Date().toISOString() },
      { onConflict: 'keyword' },
    )
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  }

  if (req.method === 'DELETE') {
    const keyword = (typeof req.query.keyword === 'string' ? req.query.keyword : '').toLowerCase().trim()
    if (!keyword) return res.status(400).json({ error: 'keyword obrigatória' })
    const { error } = await sb.from('campaign_mappings').delete().eq('keyword', keyword)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'Método não suportado' })
}
