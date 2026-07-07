/**
 * GET /api/placar-summary?month=YYYY-MM
 *
 * Endpoint de leitura para a skill do Claude — autenticado por chave estática
 * (env PLACAR_SKILL_KEY) em vez de sessão Supabase. Só leitura, sem writes.
 *
 * Retorna os dados do Placar já processados + métricas derivadas calculadas
 * (pctMeta, cpv, roasEsperado, tetoCpv, tetoCpl, status de cor por produto).
 *
 * Para configurar: adicione PLACAR_SKILL_KEY=<segredo> no Vercel.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { fetchHotmartLiquido } from './_hotmart-liquido.js'
import { fetchAllGoals } from './_goals.js'
import { fetchMetaGasto } from './_meta-gasto.js'
import { getGoalNameByCanon, getCategoriaByNome, classifyProduto } from './_produtos-db.js'
import { bqQuery, tableLeads } from './_bq.js'

const round2 = (n: number) => Math.round(n * 100) / 100

function authSkill(req: VercelRequest, res: VercelResponse): boolean {
  const key = process.env.PLACAR_SKILL_KEY ?? ''
  if (!key) { res.status(500).json({ error: 'PLACAR_SKILL_KEY não configurada no Vercel' }); return false }
  const provided = (req.headers['x-skill-key'] as string | undefined)
    ?? (typeof req.query.key === 'string' ? req.query.key : '')
  if (provided !== key) { res.status(401).json({ error: 'Chave inválida' }); return false }
  return true
}

function sb() {
  return createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_KEY ?? '',
    { auth: { persistSession: false } },
  )
}

function statusCusto(real: number | null, teto: number | null): 'verde' | 'amarelo' | 'vermelho' | null {
  if (real === null || teto === null || teto <= 0) return null
  if (real <= teto) return 'verde'
  if (real <= teto * 1.10) return 'amarelo'
  return 'vermelho'
}

function statusRoas(real: number | null, esperado: number | null): 'verde' | 'amarelo' | 'vermelho' | null {
  if (real === null || esperado === null || esperado <= 0) return null
  if (real >= esperado) return 'verde'
  if (real >= esperado * 0.90) return 'amarelo'
  return 'vermelho'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authSkill(req, res)) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')

  const now = new Date()
  const monthParam = typeof req.query.month === 'string' ? req.query.month : ''
  const month = monthParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const today = now.toISOString().slice(0, 10)

  try {
    // Dados do placar (mesma lógica do placar.ts)
    const [my, mm] = month.split('-').map(Number)
    const diasNoMes = new Date(my, mm, 0).getDate()

    const metaGastoPromise = fetchMetaGasto(month).catch(() => ({ erro: 'indisponível' } as const))

    const [hotmart, allGoals, metaResult, goalNameByCanon, categoriaByNome] = await Promise.all([
      fetchHotmartLiquido(month),
      fetchAllGoals(month),
      metaGastoPromise,
      getGoalNameByCanon(),
      getCategoriaByNome(),
    ])

    const meta = 'erro' in metaResult ? null : metaResult
    const gastoPorProduto = meta?.gastoPorProduto ?? {}
    const gastoPorEtapa = meta?.gastoPorEtapa ?? {}
    const nomesHotmart = new Set(hotmart.produtos.map(p => p.nome))

    const produtos = hotmart.produtos.map(p => {
      const goalName = goalNameByCanon[p.nome] ?? p.nome
      const metaVal = allGoals.get(goalName) ?? null
      const gasto = gastoPorProduto[p.nome] ?? 0
      const roas = gasto > 0 ? round2(p.liquido / gasto) : null
      return { ...p, meta: metaVal, goalName, gasto, roas, gastoEtapas: gastoPorEtapa[p.nome] ?? null }
    })

    // Promove core/porta sem venda
    for (const [nome, gasto] of Object.entries(gastoPorProduto)) {
      if (nomesHotmart.has(nome)) continue
      const categoria = categoriaByNome[nome] ?? 'low'
      if (categoria !== 'core' && categoria !== 'porta') continue
      const goalName = goalNameByCanon[nome] ?? nome
      const metaVal = allGoals.get(goalName) ?? null
      produtos.push({ nome, categoria, vendas: 0, liquido: 0, meta: metaVal, goalName, gasto, roas: null, gastoEtapas: gastoPorEtapa[nome] ?? null })
    }

    // Orçamentos do mês
    const { data: orcRows } = await sb()
      .from('orcamento_trafego')
      .select('product, orcamento, ticket, conversao')
      .eq('month', month)
    const orcMap: Record<string, { orcamento: number | null; ticket: number | null; conversao: number | null }> = {}
    for (const r of orcRows ?? []) {
      orcMap[r.product] = {
        orcamento: r.orcamento != null ? Number(r.orcamento) : null,
        ticket: r.ticket != null ? Number(r.ticket) : null,
        conversao: r.conversao != null ? Number(r.conversao) : null,
      }
    }

    // Ações do dia + leads UTM (campanha+content) em paralelo
    const since = `${month}-01`
    const until = new Date(my, mm, 0).toISOString().slice(0, 10)
    const tLeads = tableLeads()

    // Regras de mapeamento campanha → produto (para calcular leads por produto)
    const { data: mapRows } = await sb().from('campaign_produto_map').select('prefixo, produto_ids')
    const regras: Array<{ prefixo: string; produtoCanonico: string }> = []
    for (const r of mapRows ?? []) {
      const ids = (r.produto_ids as number[]) ?? []
      if (!ids.length || !r.prefixo) continue
      const canon = await classifyProduto(Number(ids[0]))
      regras.push({ prefixo: String(r.prefixo).toLowerCase().trim(), produtoCanonico: canon.nome })
    }
    regras.sort((a, b) => b.prefixo.length - a.prefixo.length)
    function matchP(campaign: string) {
      const n = campaign.toLowerCase()
      for (const r of regras) { if (r.prefixo && n.includes(r.prefixo)) return r.produtoCanonico }
      return null
    }

    const [acaoRows, bqLeads] = await Promise.all([
      sb().from('placar_acoes').select('produto, acao').eq('data', today),
      bqQuery(`
        SELECT utm_campaign, utm_content,
               COUNT(DISTINCT LOWER(TRIM(lead_email))) AS leads
        FROM ${tLeads}
        WHERE utm_campaign IS NOT NULL
          AND lead_email IS NOT NULL AND TRIM(lead_email) <> ''
          AND DATE(lead_register) >= @since AND DATE(lead_register) <= @until
        GROUP BY utm_campaign, utm_content ORDER BY leads DESC
      `, [{ name: 'since', value: since }, { name: 'until', value: until }])
        .catch(() => ({ rows: [] })),
    ])

    const acoes: Record<string, string> = {}
    for (const r of acaoRows.data ?? []) acoes[r.produto] = r.acao

    const leadsUtm: Record<string, number> = {}
    const leadsDist: Record<string, Array<{ campanha: string; content: string | null; leads: number }>> = {}
    for (const row of bqLeads.rows as Array<{ utm_campaign?: string; utm_content?: string; leads?: number }>) {
      const produto = matchP(row.utm_campaign ?? '')
      if (!produto) continue
      const n = Number(row.leads ?? 0)
      leadsUtm[produto] = (leadsUtm[produto] ?? 0) + n
      ;(leadsDist[produto] ??= []).push({ campanha: row.utm_campaign ?? '', content: row.utm_content ?? null, leads: n })
    }

    // Monta resumo por produto com métricas derivadas
    const totalLiquido = hotmart.totalLiquido
    const totalMeta = produtos.reduce((s, p) => s + (p.meta ?? 0), 0)
    const gastoProdutos = produtos.reduce((s, p) => s + p.gasto, 0)
    const dayOfMonth = now.getFullYear() === my && now.getMonth() + 1 === mm ? now.getDate() : diasNoMes
    const pctEsperado = round2((dayOfMonth / diasNoMes) * 100)

    const produtosComMetricas = produtos.map(p => {
      const orc = orcMap[p.nome] ?? {}
      const { orcamento, ticket, conversao } = orc

      // Alvos
      let roasEsperado: number | null = null
      let tetoCpv: number | null = null
      let tetoCpl: number | null = null
      if (orcamento && orcamento > 0 && p.meta && p.meta > 0) {
        roasEsperado = round2(p.meta / orcamento)
        if (ticket && ticket > 0) {
          const vendasNec = p.meta / ticket
          tetoCpv = round2(orcamento / vendasNec)
          if (conversao && conversao > 0) {
            const leadsNec = vendasNec / conversao
            tetoCpl = round2(orcamento / leadsNec)
          }
        }
      }

      const cpv = p.gasto > 0 && p.vendas > 0 ? round2(p.gasto / p.vendas) : null
      const pctMeta = p.meta && p.meta > 0 ? round2((p.liquido / p.meta) * 100) : null

      return {
        nome: p.nome,
        categoria: p.categoria,
        vendas: p.vendas,
        liquidoR$: round2(p.liquido),
        metaR$: p.meta ? round2(p.meta) : null,
        pctMeta,
        statusMeta: pctMeta === null ? null : pctMeta >= 100 ? 'verde' : pctMeta >= 70 ? 'amarelo' : 'vermelho',
        gastoR$: round2(p.gasto),
        orcamentoR$: orcamento ?? null,
        roas: p.roas,
        roasEsperado,
        statusRoas: statusRoas(p.roas, roasEsperado),
        cpvR$: cpv,
        tetoCpvR$: tetoCpv,
        statusCpv: statusCusto(cpv, tetoCpv),
        gastoEtapas: p.gastoEtapas,
        leadsUtm: leadsUtm[p.nome] ?? 0,
        leadsDistribuicao: leadsDist[p.nome] ?? [],
        acaoHoje: acoes[p.nome] ?? null,
      }
    }).sort((a, b) => (b.liquidoR$ ?? 0) - (a.liquidoR$ ?? 0))

    return res.json({
      month,
      today,
      resumo: {
        totalLiquidoR$: round2(totalLiquido),
        totalMetaR$: round2(totalMeta),
        pctMetaGeral: totalMeta > 0 ? round2((totalLiquido / totalMeta) * 100) : null,
        pctEsperadoHoje: pctEsperado,
        totalGastoR$: round2(meta?.totalGasto ?? 0),
        gastoProdutosR$: round2(gastoProdutos),
        roasGeral: gastoProdutos > 0 ? round2(totalLiquido / gastoProdutos) : null,
      },
      produtos: produtosComMetricas,
    })
  } catch (err) {
    console.error('placar-summary error:', err)
    return res.status(500).json({ error: 'Erro interno', detail: (err as Error).message })
  }
}
