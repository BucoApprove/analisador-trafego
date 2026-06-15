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
import { fetchMetaGasto } from './_meta-gasto.js'
import { GOAL_NAME_BY_CANON } from './_produtos-canonicos.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await authUser(req, res); if (!user) return
  if (!requireAdmin(user, res)) return

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')

  const monthParam = typeof req.query.month === 'string' ? req.query.month : ''
  const now = new Date()
  const month = monthParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  // Range opcional dentro do mês (since/until, YYYY-MM-DD). Quando válido,
  // recalcula tudo no período e particiona a meta proporcional aos dias.
  const sinceParam = typeof req.query.since === 'string' ? req.query.since : ''
  const untilParam = typeof req.query.until === 'string' ? req.query.until : ''
  const [my, mm] = month.split('-').map(Number)
  const diasNoMes = new Date(my, mm, 0).getDate()
  const rangeValido = !!(sinceParam && untilParam
    && sinceParam.slice(0, 7) === month && untilParam.slice(0, 7) === month
    && sinceParam <= untilParam)
  const range = rangeValido ? { since: sinceParam, until: untilParam } : undefined
  const diasNoRange = rangeValido
    ? (new Date(untilParam).getTime() - new Date(sinceParam).getTime()) / 86400000 + 1
    : diasNoMes
  const fatorMeta = rangeValido ? diasNoRange / diasNoMes : 1

  try {
    // Gasto Meta é opcional: se falhar (env não configurada, token), a aba
    // continua mostrando Hotmart sem quebrar. Erro vai em `metaError`.
    const metaGastoPromise = fetchMetaGasto(month, range).catch((e: Error) => {
      console.error('placar meta-gasto error:', e.message)
      return { erro: e.message } as const
    })

    const [hotmart, allGoals, metaResult] = await Promise.all([
      fetchHotmartLiquido(month, range),
      fetchAllGoals(month),
      metaGastoPromise,
    ])

    const meta = 'erro' in metaResult ? null : metaResult
    const gastoPorProduto = meta?.gastoPorProduto ?? {}
    const gastoPorEtapa = meta?.gastoPorEtapa ?? {}

    // Produtos do Hotmart que também têm gasto Meta atribuído.
    const nomesHotmart = new Set(hotmart.produtos.map(p => p.nome))

    // Anexa meta, gasto (+ split por etapa) e ROAS a cada produto.
    //   goalName = chave em monthly_goals (de/para p/ produtos antigos, nome
    //   canônico p/ novos) — edição no Placar sincroniza com a Metas Mensais.
    const produtos = hotmart.produtos.map(p => {
      const goalName = GOAL_NAME_BY_CANON[p.nome] ?? p.nome
      const metaCheia = allGoals.get(goalName) ?? null
      // meta proporcional ao range (fatorMeta = 1 quando mês inteiro)
      const metaVal = metaCheia != null ? Math.round(metaCheia * fatorMeta * 100) / 100 : null
      const gasto = gastoPorProduto[p.nome] ?? 0
      const roas = gasto > 0 ? Math.round((p.liquido / gasto) * 100) / 100 : null
      return { ...p, meta: metaVal, goalName, gasto, roas, gastoEtapas: gastoPorEtapa[p.nome] ?? null }
    })

    // Gasto atribuído a um produto que NÃO teve venda no Hotmart (ex: campanha de
    // Quiz/produto sem faturamento no mês). Aparece à parte para não sumir.
    const gastoSemVenda = Object.entries(gastoPorProduto)
      .filter(([nome]) => !nomesHotmart.has(nome))
      .map(([nome, gasto]) => ({ nome, gasto, etapas: gastoPorEtapa[nome] ?? null }))
      .sort((a, b) => b.gasto - a.gasto)

    const totalMeta = produtos.reduce((s, p) => s + (p.meta ?? 0), 0)

    res.json({
      month,
      ...hotmart,
      produtos,
      totalMeta,
      range: rangeValido ? { since: sinceParam, until: untilParam, diasNoRange, diasNoMes, fatorMeta } : null,
      meta: meta ? {
        totalGasto: meta.totalGasto,
        totalClassificado: meta.totalClassificado,
        gastoSemVenda,
        campanhas: meta.campanhas,
      } : null,
      metaError: 'erro' in metaResult ? metaResult.erro : null,
    })
  } catch (err) {
    console.error('placar error:', err)
    res.status(500).json({ error: 'Erro interno', detail: (err as Error).message })
  }
}
