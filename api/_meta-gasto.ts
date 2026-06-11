/**
 * Gasto Meta Ads das DUAS contas do negócio, classificado por produto canônico.
 *
 * Contas (env META_AD_ACCOUNTS = CSV de account_ids; fallback p/ META_AD_ACCOUNT_ID):
 *   1082683452063319 — GBS Launch (lançamentos, Buco, Intensivo, Imersão, topo)
 *   565958430809772  — GBS Pós-graduações (Pós + Low ticket, inclusive intl)
 *
 * Classificação por palavra no nome da campanha (primeira que casar), espelhando
 * a régua do placar do sócio. Campanhas que não casam com produto viram "topo"
 * (descoberta/relacionamento/remarketing) — gasto que não entra no ROAS de produto.
 */

// nome canônico do produto OU rótulo de topo de funil.
export interface CampanhaGasto {
  campaign: string
  conta: string
  spend: number
  alvo: string        // produto canônico ou rótulo de topo
  isProduto: boolean  // true = casa com um produto canônico (entra no ROAS)
}

export interface MetaGasto {
  campanhas: CampanhaGasto[]
  gastoPorProduto: Record<string, number>  // só alvos isProduto=true
  gastoTopo: Record<string, number>        // descoberta/relacionamento/remarketing/não atribuído
  totalGasto: number       // soma das contas (fechamento real)
  totalClassificado: number
}

// Régua de classificação: [keyword, alvo, isProduto]. Primeira que casar vence.
// Os alvos isProduto=true usam exatamente os nomes canônicos (api/_produtos-canonicos.ts).
const REGRAS: Array<[string, string, boolean]> = [
  ['low_', 'Low ticket', true],
  ['intensiv', 'Intensivo ENARE', true],
  ['vendas anato', 'Pós Anatomia', true],
  ['anatomia', 'Pós Anatomia', true],
  ['patologia', 'Pós Patologia', true],
  ['mentoria', 'Mentoria CTBMF', true],
  ['pptba', 'Buco Approve', true],
  ['bucoapprove', 'Buco Approve', true],
  ['ba25', 'Buco Approve', true],
  ['planejamento', 'Planejamento ImpulsoR+', true],
  ['rota enare', 'Rota Enare', true],
  ['renova', 'Renovação de acesso', true],
  // portas de entrada (geram lead, vendem indireto — tratadas como produto p/ ROAS próprio)
  ['imersao', 'Imersão ENARE', true],
  ['imersão', 'Imersão ENARE', true],
  ['quiz', 'Quiz ENARE', true],
  // topo de funil (não atribuível a produto)
  ['[instagram]', 'Topo: Descoberta', false],
  ['post:', 'Topo: Descoberta', false],
  ['video', 'Topo: Descoberta', false],
  ['vview', 'Topo: Descoberta', false],
  ['captura', 'Topo: Descoberta', false],
  ['aulas semanais', 'Topo: Descoberta', false],
  ['relacionamento', 'Topo: Relacionamento', false],
  ['engajamento', 'Topo: Relacionamento', false],
  ['remarketing', 'Topo: Remarketing', false],
  ['rmkt', 'Topo: Remarketing', false],
]

function classificarCampanha(nome: string): { alvo: string; isProduto: boolean } {
  const n = nome.toLowerCase()
  for (const [kw, alvo, isProduto] of REGRAS) {
    if (n.includes(kw)) return { alvo, isProduto }
  }
  return { alvo: 'Topo: não atribuído', isProduto: false }
}

function accountIds(): string[] {
  const multi = (process.env.META_AD_ACCOUNTS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (multi.length > 0) return multi
  const single = process.env.META_AD_ACCOUNT_ID ?? ''
  return single ? [single.replace(/^act_/, '')] : []
}

const round = (n: number) => Math.round(n * 100) / 100

/** Busca e classifica o gasto Meta das contas configuradas para um mês "YYYY-MM". */
export async function fetchMetaGasto(month: string): Promise<MetaGasto> {
  const token = process.env.META_ACCESS_TOKEN ?? ''
  const accounts = accountIds()
  if (!token || accounts.length === 0) {
    throw new Error('META_ACCESS_TOKEN ou META_AD_ACCOUNTS/META_AD_ACCOUNT_ID não configurado')
  }

  const [y, m] = month.split('-').map(Number)
  const since = `${month}-01`
  const until = new Date(y, m, 0).toISOString().slice(0, 10)
  const timeRange = JSON.stringify({ since, until })

  const campanhas: CampanhaGasto[] = []
  const gastoPorProduto: Record<string, number> = {}
  const gastoTopo: Record<string, number> = {}
  let totalGasto = 0

  for (const aid of accounts) {
    // gasto por campanha
    const campUrl = new URL(`https://graph.facebook.com/v21.0/act_${aid}/insights`)
    campUrl.searchParams.set('level', 'campaign')
    campUrl.searchParams.set('fields', 'campaign_name,spend')
    campUrl.searchParams.set('time_range', timeRange)
    campUrl.searchParams.set('limit', '500')
    campUrl.searchParams.set('access_token', token)

    const cRes = await fetch(campUrl.toString())
    if (!cRes.ok) throw new Error(`Meta insights act_${aid}: ${cRes.status} ${(await cRes.text()).slice(0, 200)}`)
    const cData = await cRes.json() as { data?: Array<{ campaign_name?: string; spend?: string }> }

    for (const row of cData.data ?? []) {
      const spend = Number(row.spend ?? 0)
      if (!spend) continue
      const nome = row.campaign_name ?? '(sem nome)'
      const { alvo, isProduto } = classificarCampanha(nome)
      campanhas.push({ campaign: nome, conta: aid, spend: round(spend), alvo, isProduto })
      if (isProduto) gastoPorProduto[alvo] = (gastoPorProduto[alvo] ?? 0) + spend
      else gastoTopo[alvo] = (gastoTopo[alvo] ?? 0) + spend
    }

    // total da conta (fechamento — pega gasto sem campanha/arquivado também)
    const totUrl = new URL(`https://graph.facebook.com/v21.0/act_${aid}/insights`)
    totUrl.searchParams.set('fields', 'spend')
    totUrl.searchParams.set('time_range', timeRange)
    totUrl.searchParams.set('access_token', token)
    const tRes = await fetch(totUrl.toString())
    if (tRes.ok) {
      const tData = await tRes.json() as { data?: Array<{ spend?: string }> }
      totalGasto += Number(tData.data?.[0]?.spend ?? 0)
    }
  }

  for (const k of Object.keys(gastoPorProduto)) gastoPorProduto[k] = round(gastoPorProduto[k])
  for (const k of Object.keys(gastoTopo)) gastoTopo[k] = round(gastoTopo[k])
  const totalClassificado = round(
    Object.values(gastoPorProduto).reduce((s, v) => s + v, 0) + Object.values(gastoTopo).reduce((s, v) => s + v, 0),
  )

  return {
    campanhas: campanhas.sort((a, b) => b.spend - a.spend),
    gastoPorProduto,
    gastoTopo,
    totalGasto: round(totalGasto),
    totalClassificado,
  }
}
