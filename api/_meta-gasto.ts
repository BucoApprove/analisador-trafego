/**
 * Gasto Meta Ads das contas do negócio, atribuído a produto + etapa.
 *
 * Contas (env META_AD_ACCOUNTS = CSV de account_ids; fallback p/ META_AD_ACCOUNT_ID):
 *   1082683452063319 — GBS Launch (conta1)
 *   565958430809772  — GBS Pós-graduações (conta2)
 *
 * Atribuição de PRODUTO: reusa a tabela campaign_produto_map (prefixo →
 * produto_ids[], por conta) — a mesma editada em "Produtos/Campanhas". O prefixo
 * casa por includes no nome da campanha; o 1º produto_id é convertido no nome
 * canônico via classifyProduto. Campanha que não casa → "Buco Approve".
 *
 * Atribuição de ETAPA: derivada do nome por palavra-chave fixa
 * (conversão / remarketing / descoberta / relacionamento). Default: conversão.
 */
import { createClient } from '@supabase/supabase-js'
import { classifyProduto } from './_produtos-canonicos.js'

export type Etapa = 'conversão' | 'remarketing' | 'descoberta' | 'relacionamento'
export const ETAPAS: Etapa[] = ['conversão', 'remarketing', 'descoberta', 'relacionamento']

export const FALLBACK_PRODUTO = 'Buco Approve'

// account_id Meta → chave de conta usada na campaign_produto_map.
const META_ACCOUNT_TO_CONTA: Record<string, string> = {
  '1082683452063319': 'conta1', // GBS Launch
  '565958430809772':  'conta2', // GBS Pós-graduações
}

export interface CampanhaGasto {
  campaign: string
  conta: string
  spend: number
  produto: string
  etapa: Etapa
}

export interface MetaGasto {
  campanhas: CampanhaGasto[]
  gastoPorProduto: Record<string, number>
  gastoPorEtapa: Record<string, Record<Etapa, number>>
  totalGasto: number          // soma real das contas (fechamento)
  totalClassificado: number   // soma atribuída a campanhas
}

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

interface Regra { prefixo: string; produtoCanonico: string }

/** Carrega regras prefixo→produto canônico da campaign_produto_map para uma conta. */
async function fetchRegras(conta: string): Promise<Regra[]> {
  const sb = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_KEY ?? '', {
    auth: { persistSession: false },
  })
  const { data, error } = await sb
    .from('campaign_produto_map')
    .select('prefixo, produto_ids')
    .eq('account', conta)
  if (error) throw new Error(`campaign_produto_map query failed: ${error.message}`)

  const regras: Regra[] = []
  for (const r of data ?? []) {
    const ids = (r.produto_ids as number[]) ?? []
    if (ids.length === 0 || !r.prefixo) continue
    // 1º produto_id → nome canônico (sem oferta: ofertas só importam dentro do Buco)
    const produtoCanonico = classifyProduto(Number(ids[0])).nome
    regras.push({ prefixo: String(r.prefixo).toLowerCase().trim(), produtoCanonico })
  }
  // prefixo mais longo primeiro: regra mais específica vence
  return regras.sort((a, b) => b.prefixo.length - a.prefixo.length)
}

function matchProduto(nome: string, regras: Regra[]): string {
  const n = nome.toLowerCase()
  for (const r of regras) {
    if (r.prefixo && n.includes(r.prefixo)) return r.produtoCanonico
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

  const [y, m] = month.split('-').map(Number)
  const since = `${month}-01`
  const until = new Date(y, m, 0).toISOString().slice(0, 10)
  const timeRange = JSON.stringify({ since, until })

  const campanhas: CampanhaGasto[] = []
  const gastoPorProduto: Record<string, number> = {}
  const gastoPorEtapa: Record<string, Record<Etapa, number>> = {}
  let totalGasto = 0

  // cache de regras por conta (evita refetch se a mesma conta repetir)
  const regrasCache = new Map<string, Regra[]>()

  for (const aid of accounts) {
    const conta = META_ACCOUNT_TO_CONTA[aid] ?? 'conta1'
    let regras = regrasCache.get(conta)
    if (!regras) { regras = await fetchRegras(conta); regrasCache.set(conta, regras) }

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
      campanhas.push({ campaign: nome, conta, spend: round(spend), produto, etapa })

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
