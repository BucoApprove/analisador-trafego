/**
 * CRUD da tabela produtos_canonicos.
 *
 * GET    /api/produtos-canonicos         → lista todos (auth obrigatória)
 * POST   /api/produtos-canonicos         → upsert (body: DbRow; admin only)
 * DELETE /api/produtos-canonicos?id=N    → remove por product_id (admin only)
 *
 * Após qualquer write invalida o cache do helper _produtos-db.ts.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { authUser, requireAdmin } from './_supabase-auth.js'
import { invalidateCache } from './_produtos-db.js'

function sb() {
  return createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_KEY ?? '',
    { auth: { persistSession: false } },
  )
}

// product_ids que não podem ser removidos
const PROTECTED_IDS = new Set([2016048, 6766383])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await authUser(req, res)
  if (!user) return

  // ── GET ────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await sb()
      .from('produtos_canonicos')
      .select('product_id,nome,categoria,goal_name,intensivo_offer_codes,is_low_ticket,is_intensivo_marker')
      .order('nome')
    if (error) return res.status(500).json({ error: error.message })
    return res.json(data ?? [])
  }

  // Writes: admin only
  if (!requireAdmin(user, res)) return

  // ── POST (upsert) ──────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body as {
      product_id?: unknown
      nome?: unknown
      categoria?: unknown
      goal_name?: unknown
      intensivo_offer_codes?: unknown
      is_low_ticket?: unknown
      is_intensivo_marker?: unknown
    }

    const product_id = Number(body.product_id)
    if (!product_id && product_id !== 0) return res.status(400).json({ error: 'product_id obrigatório' })
    const nome = String(body.nome ?? '').trim()
    if (!nome) return res.status(400).json({ error: 'nome obrigatório' })
    const categoria = String(body.categoria ?? '')
    if (!['core', 'porta', 'low'].includes(categoria)) return res.status(400).json({ error: 'categoria inválida' })

    const row = {
      product_id,
      nome,
      categoria,
      goal_name:             body.goal_name ? String(body.goal_name).trim() || null : null,
      intensivo_offer_codes: Array.isArray(body.intensivo_offer_codes)
        ? (body.intensivo_offer_codes as unknown[]).map(String).filter(Boolean)
        : (typeof body.intensivo_offer_codes === 'string' && body.intensivo_offer_codes.trim()
            ? body.intensivo_offer_codes.split(',').map(s => s.trim()).filter(Boolean)
            : null),
      is_low_ticket:      Boolean(body.is_low_ticket),
      is_intensivo_marker: Boolean(body.is_intensivo_marker),
      updated_at:         new Date().toISOString(),
    }

    const { error } = await sb().from('produtos_canonicos').upsert(row, { onConflict: 'product_id' })
    if (error) return res.status(500).json({ error: error.message })

    invalidateCache()
    return res.json({ ok: true })
  }

  // ── DELETE ─────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const idParam = typeof req.query.id === 'string' ? req.query.id : ''
    const product_id = Number(idParam)
    if (!product_id && product_id !== 0) return res.status(400).json({ error: 'id obrigatório' })

    if (PROTECTED_IDS.has(product_id)) {
      return res.status(400).json({ error: 'Este produto não pode ser removido.' })
    }

    const { error } = await sb().from('produtos_canonicos').delete().eq('product_id', product_id)
    if (error) return res.status(500).json({ error: error.message })

    invalidateCache()
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
