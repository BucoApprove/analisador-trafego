/**
 * CRUD das tags da Clint por produto (Leads Clint do Placar).
 *
 * GET    → lista as regras (product_name, tag_id, label)
 * POST   → cria uma regra { product_name, tag_id, label? }
 * DELETE → remove uma regra (?id=...)
 *
 * Admin-only. RLS off.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { authUser, requireAdmin } from './_supabase-auth.js'

function getSupabase() {
  return createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_KEY ?? '', {
    auth: { persistSession: false },
  })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await authUser(req, res); if (!user) return
  if (!requireAdmin(user, res)) return

  const sb = getSupabase()

  if (req.method === 'GET') {
    const { data, error } = await sb.from('clint_tags').select('id, product_name, tag_id, label').order('product_name')
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ tags: data ?? [] })
  }

  if (req.method === 'POST') {
    const productName = String(req.body?.product_name ?? '').trim()
    const tagId = String(req.body?.tag_id ?? '').trim()
    const label = String(req.body?.label ?? '').trim()
    if (!productName || !tagId) {
      return res.status(400).json({ error: 'product_name e tag_id são obrigatórios' })
    }
    const { error } = await sb.from('clint_tags').upsert(
      { product_name: productName, tag_id: tagId, label },
      { onConflict: 'product_name,tag_id' },
    )
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  }

  if (req.method === 'DELETE') {
    const id = typeof req.query.id === 'string' ? req.query.id : ''
    if (!id) return res.status(400).json({ error: 'id obrigatório' })
    const { error } = await sb.from('clint_tags').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'Método não suportado' })
}
