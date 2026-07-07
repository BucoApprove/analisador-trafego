/**
 * GET /api/clint-leads-detail?produto=X&since=YYYY-MM-DD&until=YYYY-MM-DD
 * Retorna lista detalhada de deals Clint para o modal do Placar.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authUser, requireAdmin } from './_supabase-auth.js'
import { fetchClintLeadsDetalhados } from './_clint.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await authUser(req, res); if (!user) return
  if (!requireAdmin(user, res)) return

  res.setHeader('Cache-Control', 'no-store')

  const produto = typeof req.query.produto === 'string' ? req.query.produto.trim() : ''
  const since   = typeof req.query.since   === 'string' ? req.query.since.trim()   : ''
  const until   = typeof req.query.until   === 'string' ? req.query.until.trim()   : ''

  if (!produto || !since || !until) {
    return res.status(400).json({ error: 'produto, since e until são obrigatórios' })
  }

  try {
    const deals = await fetchClintLeadsDetalhados(since, until, produto)
    return res.json({ deals })
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
}
