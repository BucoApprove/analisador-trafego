import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { authUser } from './_supabase-auth.js'

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_KEY ?? '',
    { auth: { persistSession: false } },
  )
}

const VALID_ACCOUNTS = new Set(['conta1', 'conta2'])
const VALID_VIEWS    = new Set([
  'etapa1', 'etapa2', 'etapa3', 'etapa4', 'etapa5',
  'anatomia', 'patologia', 'lowticket-brasil', 'lowticket-latam',
])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const _user = await authUser(req, res); if (!_user) return

  const sb = getSupabase()

  // ── GET: retorna filtro salvo (ou null se usando padrão) ──────────────────
  if (req.method === 'GET') {
    const account = typeof req.query.account === 'string' ? req.query.account : ''
    const view    = typeof req.query.view    === 'string' ? req.query.view    : ''
    if (!VALID_ACCOUNTS.has(account) || !VALID_VIEWS.has(view)) {
      return res.status(400).json({ error: 'Parâmetros inválidos' })
    }
    const { data, error } = await sb
      .from('etapa_filters')
      .select('include, exclude')
      .eq('account', account)
      .eq('view', view)
      .maybeSingle()
    if (error) {
      console.error('etapa-filters GET error:', error)
      return res.status(500).json({ error: error.message })
    }
    return res.json({ filter: data ?? null })
  }

  // ── POST: salva filtro customizado ────────────────────────────────────────
  if (req.method === 'POST') {
    const { account, view, include, exclude } = req.body ?? {}
    if (!VALID_ACCOUNTS.has(account) || !VALID_VIEWS.has(view)) {
      return res.status(400).json({ error: 'Parâmetros inválidos' })
    }
    if (!Array.isArray(include) || !Array.isArray(exclude)) {
      return res.status(400).json({ error: 'include e exclude devem ser arrays' })
    }
    const clean = (arr: unknown[]) =>
      arr.map(s => String(s).toLowerCase().trim()).filter(Boolean)

    const { error } = await sb.from('etapa_filters').upsert(
      { account, view, include: clean(include), exclude: clean(exclude), updated_at: new Date().toISOString() },
      { onConflict: 'account,view' },
    )
    if (error) {
      console.error('etapa-filters POST error:', error)
      return res.status(500).json({ error: error.message })
    }
    return res.json({ ok: true })
  }

  // ── DELETE: remove filtro customizado (volta ao padrão) ───────────────────
  if (req.method === 'DELETE') {
    const account = typeof req.query.account === 'string' ? req.query.account : ''
    const view    = typeof req.query.view    === 'string' ? req.query.view    : ''
    const { error } = await sb.from('etapa_filters').delete().eq('account', account).eq('view', view)
    if (error) {
      console.error('etapa-filters DELETE error:', error)
      return res.status(500).json({ error: error.message })
    }
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'Método não suportado' })
}
