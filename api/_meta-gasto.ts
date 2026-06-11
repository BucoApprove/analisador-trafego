/**
 * Gasto Meta Ads das DUAS contas do negócio, atribuído a produto + etapa.
 *
 * Contas (env META_AD_ACCOUNTS = CSV de account_ids; fallback p/ META_AD_ACCOUNT_ID):
 *   1082683452063319 — GBS Launch
 *   565958430809772  — GBS Pós-graduações
 *
 * Atribuição de PRODUTO: por keyword no nome da campanha (tabela
 * campaign_mappings, editável na UI). A primeira keyword que casar vence.
 * Campanha que não casa com nenhuma regra → "Buco Approve" (fallback total).
 *
 * Atribuição de ETAPA: derivada do nome da campanha por palavra-chave fixa
 * (conversão / remarketing / descoberta / relacionamento). Default: conversão.
 */
import { createClient } from '@supabase/supabase-js'

export type Etapa = 'conversão' | 'remarketing' | 'descoberta' | 'relacionamento'
export const ETAPAS: Etapa[] = ['conversão', 'remarketing', 'descoberta', 'relacionamento']

export const FALLBACK_PRODUTO = 'Buco Approve'

export interface CampanhaGasto {
  campaign: string
  conta: string
  spend: number
  produto: string
  etapa: Etapa
}

export interface MetaGasto {
  campanhas: CampanhaGasto[]
  // gasto[produto] = total; gastoPorEtapa[produto][etapa] = split p/ tooltip
  gastoPorProduto: Record<string, number>
  gastoPorEtapa: Record<string, Record<Etapa, number>>
  totalGasto: number          // soma real das contas (fechamento)
  totalClassificado: number   // soma do que foi atribuído a campanhas
}

// Detecção de etapa por palavra-chave no nome (primeira que casar). Default: conversão.
const ETAPA_KEYWORDS: Array<[string, Etapa]> = [
  ['remarketing', 'remarketing'],
  ['rmkt', 'remarketing'],
  ['relacionamento', 'relacionamento'],
  ['engajamento', 'relacionamento'],
  ['descoberta', 'descoberta'],
  ['[instagram]', 'descoberta'],
  ['post:', 'descoberta'],
  ['video', 'descoberta'],
  ['vview', 'descoberta'],
  ['captura', 'descoberta'],
  ['aulas semanais', 'descoberta'],
]

function detectarEtapa(nome: string): Etapa {
  const n = nome.toLowerCase()
  for (const [kw, etapa] of ETAPA_KEYWORDS) {
    if (n.includes(kw)) return etapa
  }
  return 'conversão'
}

function accountIds(): string[] {
  const multi = (process.env.META_AD_ACCOUNTS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (multi.length > 0) return multi
  const single = process.env.META_AD_ACCOUNT_ID ?? ''
  return single ? [single.replace(/^act_/, '')] : []
}

async function fetchCampaignMappings(): Promise<Array<{ keyword: string; product: string }>> {
  const sb = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_KEY ?? '', {
    auth: { persistSession: false },
  })
  const { data, error } = await sb.from('campaign_mappings').select('keyword, product_name')
  if (error) throw new Error(`campaign_mappings query failed: ${error.message}`)
  // keywords mais longas primeiro: regra mais específica vence
  return (data ?? [])
    .map(r => ({ keyword: r.keyword.toLowerCase(), product: r.product_name }))
    .sort((a, b) => b.keyword.length - a.keyword.length)
}

function matchProduto(nome: string, regras: Array<{ keyword: string; product: string }>): string {
  const n = nome.toLowerCase()
  for (const r of regras) {
    if (r.keyword && n.includes(r.keyword)) return r.product
  }
  return FALLBACK_PRODUTO
}

const round = (n: number) => Math.round(n * 100) / 100

function emptyEtapas(): Record<Etapa, number> {
  return { 'conversão': 0, remarketing: 0, descoberta: 0, relacionamento: 0 }
}

/** Busca e atribui o gasto Meta das contas configuradas para um mês "YYYY-MM". */
export async function fetchMetaGasto(month: string): Promise<MetaGasto> {
  const token = process.env.META_ACCESS_TOKEN ?? ''
  const accounts = accountIds()
  if (!token || accounts.length === 0) {
    throw new Error('META_ACCESS_TOKEN ou META_AD_ACCOUNTS/META_AD_ACCOUNT_ID não configurado')
  }

  const regras = await fetchCampaignMappings()

  const [y, m] = month.split('-').map(Number)
  const since = `${month}-01`
  const until = new Date(y, m, 0).toISOString().slice(0, 10)
  const timeRange = JSON.stringify({ since, until })

  const campanhas: CampanhaGasto[] = []
  const gastoPorProduto: Record<string, number> = {}
  const gastoPorEtapa: Record<string, Record<Etapa, number>> = {}
  let totalGasto = 0

  for (const aid of accounts) {
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
      const produto = matchProduto(nome, regras)
      const etapa = detectarEtapa(nome)
      campanhas.push({ campaign: nome, conta: aid, spend: round(spend), produto, etapa })

      gastoPorProduto[produto] = (gastoPorProduto[produto] ?? 0) + spend
      ;(gastoPorEtapa[produto] ??= emptyEtapas())[etapa] += spend
    }

    // total da conta (fechamento)
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
  for (const p of Object.keys(gastoPorEtapa)) {
    for (const e of ETAPAS) gastoPorEtapa[p][e] = round(gastoPorEtapa[p][e])
  }
  const totalClassificado = round(Object.values(gastoPorProduto).reduce((s, v) => s + v, 0))

  return {
    campanhas: campanhas.sort((a, b) => b.spend - a.spend),
    gastoPorProduto,
    gastoPorEtapa,
    totalGasto: round(totalGasto),
    totalClassificado,
  }
}
