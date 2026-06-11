/**
 * Vendas reais (todas, incl. compra direta sem lead) dos produtos de um
 * lançamento, num intervalo de datas. Conta por product_id via Hotmart
 * commissions — resolve o caso do lançamento pago onde a maioria das vendas
 * vai direto ao checkout sem cruzar com lead.
 *
 * GET /api/lancamento-vendas?since=YYYY-MM-DD&until=YYYY-MM-DD
 * Retorna { vendasPorProduto: { nomeCanonico: { vendas, liquido } } }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authUser } from './_supabase-auth.js'
import { fetchVendasPorProdutoRange } from './_hotmart-liquido.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await authUser(req, res); if (!user) return

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')

  const since = typeof req.query.since === 'string' ? req.query.since : ''
  const until = typeof req.query.until === 'string' ? req.query.until : ''
  if (!since || !until) {
    return res.status(400).json({ error: 'since e until são obrigatórios (YYYY-MM-DD)' })
  }

  try {
    const { totais, diario } = await fetchVendasPorProdutoRange(since, until)
    // mantém a chave vendasPorProduto (totais) p/ retrocompat + diário por produto
    res.json({ since, until, vendasPorProduto: totais, diarioPorProduto: diario })
  } catch (err) {
    console.error('lancamento-vendas error:', err)
    res.status(500).json({ error: 'Erro interno', detail: (err as Error).message })
  }
}
