/**
 * Busca metas mensais do Supabase (tabela monthly_goals).
 *
 * Query params:
 *   month — YYYY-MM
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authUser } from './_supabase-auth.js'
import { fetchMonthlyGoals, PRODUTOS_FIXOS } from './_goals.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const _user = await authUser(req, res); if (!_user) return

  // Cache curto: a fonte agora é o Supabase e edições devem refletir rápido.
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=30')

  const monthParam = typeof req.query.month === 'string' ? req.query.month : ''
  const now = new Date()
  const month = monthParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  try {
    const { goals: goalsMap, totalMeta, configured } = await fetchMonthlyGoals(month)

    if (!configured) {
      // Aba não encontrada — retorna produtos com meta 0
      return res.json({
        month,
        goals: PRODUTOS_FIXOS.map(name => ({ name, meta: 0 })),
        configured: false,
      })
    }

    const goals = PRODUTOS_FIXOS.map(name => ({ name, meta: goalsMap[name] ?? 0 }))
    res.json({ month, goals, totalMeta, configured: true })
  } catch (err) {
    console.error('monthly-goals error:', err)
    res.status(500).json({ error: 'Erro interno', detail: (err as Error).message })
  }
}
