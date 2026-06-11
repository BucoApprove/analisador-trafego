/**
 * Endpoint da aba "Placar do Negócio" (nova, paralela à Metas Mensais).
 *
 * Fase 1 (atual): vendas + faturamento LÍQUIDO (commissions PRODUCER) por
 * produto canônico, com drill-down de ofertas do BucoApprove e totais por
 * categoria (core / porta de entrada / low ticket).
 *
 * Próximas fases: gasto Meta (2 contas) + ROAS, leads (BQ + Clint), alertas.
 *
 * Query params:
 *   month — YYYY-MM (default: mês corrente)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authUser, requireAdmin } from './_supabase-auth.js'
import { fetchHotmartLiquido } from './_hotmart-liquido.js'
import { fetchAllGoals } from './_goals.js'
import { GOAL_NAME_BY_CANON } from './_produtos-canonicos.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await authUser(req, res); if (!user) return
  if (!requireAdmin(user, res)) return

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')

  const monthParam = typeof req.query.month === 'string' ? req.query.month : ''
  const now = new Date()
  const month = monthParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  try {
    const [hotmart, allGoals] = await Promise.all([
      fetchHotmartLiquido(month),
      fetchAllGoals(month),
    ])

    // Anexa a meta a cada produto. goalName = chave usada na tabela monthly_goals:
    //   - produto que casa no de/para → nome antigo (ex: Low ticket → Low tickets)
    //   - produto novo → o próprio nome canônico (ex: Imersão ENARE)
    // Assim a edição de meta no Placar grava na mesma tabela da Metas Mensais.
    const produtos = hotmart.produtos.map(p => {
      const goalName = GOAL_NAME_BY_CANON[p.nome] ?? p.nome
      const meta = allGoals.get(goalName) ?? null
      return { ...p, meta, goalName }
    })

    const totalMeta = produtos.reduce((s, p) => s + (p.meta ?? 0), 0)

    res.json({ month, ...hotmart, produtos, totalMeta })
  } catch (err) {
    console.error('placar error:', err)
    res.status(500).json({ error: 'Erro interno', detail: (err as Error).message })
  }
}
