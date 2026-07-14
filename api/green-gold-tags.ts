/**
 * CRUD das tags do Green_Gold (BigQuery) por produto, usadas para separar
 * leads pago vs orgânico no gráfico de distribuição do Placar.
 *
 * GET    → lista as regras (product_name, tag_name)
 * POST   → cria uma regra { product_name, tag_name }
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
    const { data, error } = await sb.from('green_gold_tags').select('id, product_name, tag_name').order('product_name')
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ tags: data ?? [] })
  }

  if (req.method === 'POST') {
    const productName = String(req.body?.product_name ?? '').trim()
    const tagName = String(req.body?.tag_name ?? '').trim()
    if (!productName || !tagName) {
      return res.status(400).json({ error: 'product_name e tag_name são obrigatórios' })
    }
    const { error } = await sb.from('green_gold_tags').upsert(
      { product_name: productName, tag_name: tagName },
      { onConflict: 'product_name,tag_name' },
    )
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  }

  if (req.method === 'DELETE') {
    const id = typeof req.query.id === 'string' ? req.query.id : ''
    if (!id) return res.status(400).json({ error: 'id obrigatório' })
    const { error } = await sb.from('green_gold_tags').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'Método não suportado' })
}
