/**
 * DIAGNÓSTICO DESCARTÁVEL — comparar métodos de faturamento líquido na Hotmart.
 *
 * Compara, para um mês, o líquido calculado por:
 *   A) sales/commissions  → comissão source=PRODUCER por transaction (método novo)
 *   B) hotmart_fee.base - fee - 2.19  → heurística atual (hotmart-sales.ts)
 *
 * Também agrupa por product.id (mapeamento canônico) e separa ofertas do
 * BucoApprove por offer.code, para validar o desenho da nova aba.
 *
 * Uso: GET /api/diag-commissions?month=2026-06   (Bearer admin)
 *
 * APAGAR depois de validar.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authUser } from './_supabase-auth.js'

const BUCO_PID = 2016048
const INTENSIVO_OFFERS = new Set(['wgmh3qg1', '32ypw9pk'])

// Mapa canônico por product.id (do prompt do sócio).
const PRODUTOS: Record<number, string> = {
  2016048: 'BucoApprove',
  3811518: 'Mentoria CTBMF',
  5694443: 'Pós Patologia',
  6115663: 'Pós Anatomia',
  6739963: 'Planejamento ImpulsoR+',
  3510472: 'Renovação de acesso',
  4739673: 'Rota Enare',
  2286372: 'BucoApp',
  7737553: 'Imersão ENARE',
}

async function getToken(): Promise<string> {
  const cid = process.env.HOTMART_CLIENT_ID ?? ''
  const csec = process.env.HOTMART_CLIENT_SECRET ?? ''
  if (!cid || !csec) throw new Error('HOTMART_CLIENT_ID / HOTMART_CLIENT_SECRET ausentes')
  const basic = Buffer.from(`${cid}:${csec}`).toString('base64')
  const r = await fetch('https://api-sec-vlc.hotmart.com/security/oauth/token?grant_type=client_credentials', {
    method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
  })
  if (!r.ok) throw new Error(`OAuth ${r.status}`)
  const d = await r.json() as { access_token?: string }
  if (!d.access_token) throw new Error('sem access_token')
  return d.access_token
}

interface SaleItem {
  product?: { id: number; name: string }
  purchase?: { transaction?: string; offer?: { code?: string }; price?: { value?: number; currency_code?: string }; hotmart_fee?: { base?: number; total?: number }; status?: string }
  transaction?: string
}

async function paginate<T>(url: string, token: string, key: 'items'): Promise<T[]> {
  const out: T[] = []
  let pageToken: string | undefined
  for (let i = 0; i < 60; i++) {
    const u = new URL(url)
    if (pageToken) u.searchParams.set('page_token', pageToken)
    const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
    if (!r.ok) throw new Error(`${url} → ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const d = await r.json() as Record<string, unknown>
    out.push(...((d[key] as T[]) ?? []))
    pageToken = (d.page_info as { next_page_token?: string })?.next_page_token
    if (!pageToken) break
  }
  return out
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await authUser(req, res); if (!user) return

  const monthParam = typeof req.query.month === 'string' ? req.query.month : ''
  const [y, m] = monthParam ? monthParam.split('-').map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1]
  const startMs = new Date(y, m - 1, 1, 0, 0, 0, 0).getTime()
  const endMs = new Date(y, m, 0, 23, 59, 59, 999).getTime()

  try {
    const token = await getToken()
    const base = `start_date=${startMs}&end_date=${endMs}&max_results=50`

    // A) commissions → PRODUCER por transaction
    const commItems = await paginate<{ transaction?: string; commissions?: Array<{ source?: string; commission?: { value?: number } }> }>(
      `https://developers.hotmart.com/payments/api/v1/sales/commissions?${base}`, token, 'items',
    )
    const producerByTx = new Map<string, number>()
    for (const it of commItems) {
      for (const c of it.commissions ?? []) {
        if (c.source === 'PRODUCER' && it.transaction) producerByTx.set(it.transaction, c.commission?.value ?? 0)
      }
    }

    // history (APPROVED + COMPLETE) deduplicado
    const [appr, compl] = await Promise.all([
      paginate<SaleItem>(`https://developers.hotmart.com/payments/api/v1/sales/history?transaction_status=APPROVED&${base}`, token, 'items'),
      paginate<SaleItem>(`https://developers.hotmart.com/payments/api/v1/sales/history?transaction_status=COMPLETE&${base}`, token, 'items'),
    ])
    const seen = new Set<string>()
    const hist: SaleItem[] = []
    for (const it of [...appr, ...compl]) {
      const tx = it.purchase?.transaction ?? it.transaction ?? ''
      if (tx && seen.has(tx)) continue
      if (tx) seen.add(tx)
      hist.push(it)
    }

    // Agrupa por product.id pelos dois métodos
    type Row = { produto: string; productId: number; hotmartName: string; vendas: number; liqCommissions: number; liqHeuristica: number; semCommission: number }
    const byProduct = new Map<number, Row>()
    const bucoOffers = new Map<string, { vendas: number; liq: number }>()
    let totalComm = 0, totalHeur = 0, txSemComm = 0

    for (const it of hist) {
      const pid = it.product?.id ?? 0
      const tx = it.purchase?.transaction ?? it.transaction ?? ''
      const currency = it.purchase?.price?.currency_code ?? 'BRL'
      if (currency !== 'BRL') continue

      // Método A: commissions
      const comm = producerByTx.get(tx)
      const liqA = comm ?? 0
      if (comm === undefined) txSemComm++

      // Método B: heurística atual
      const baseV = it.purchase?.hotmart_fee?.base ?? it.purchase?.price?.value ?? 0
      const fee = it.purchase?.hotmart_fee?.total ?? 0
      const nl = (it.product?.name ?? '').toLowerCase()
      const extra = !nl.includes('pack') && !nl.includes('mentoria') && !nl.includes('renova') ? 2.19 : 0
      const liqB = baseV - fee - extra

      const nome = PRODUTOS[pid] ?? `(não mapeado ${pid})`
      const row = byProduct.get(pid) ?? { produto: nome, productId: pid, hotmartName: it.product?.name ?? '?', vendas: 0, liqCommissions: 0, liqHeuristica: 0, semCommission: 0 }
      row.vendas++; row.liqCommissions += liqA; row.liqHeuristica += liqB
      if (comm === undefined) row.semCommission++
      byProduct.set(pid, row)

      totalComm += liqA; totalHeur += liqB

      if (pid === BUCO_PID) {
        const code = it.purchase?.offer?.code ?? '(sem code)'
        const grupo = INTENSIVO_OFFERS.has(code) ? `Intensivo ENARE [${code}]` : `Buco core [${code}]`
        const o = bucoOffers.get(grupo) ?? { vendas: 0, liq: 0 }
        o.vendas++; o.liq += liqA
        bucoOffers.set(grupo, o)
      }
    }

    const round = (n: number) => Math.round(n * 100) / 100
    const produtos = [...byProduct.values()].map(r => ({
      ...r, liqCommissions: round(r.liqCommissions), liqHeuristica: round(r.liqHeuristica),
      diff: round(r.liqCommissions - r.liqHeuristica),
    })).sort((a, b) => b.liqCommissions - a.liqCommissions)

    // Destaque: IDs que faltam no mapa canônico, com o nome Hotmart para classificar.
    const naoMapeados = produtos
      .filter(p => p.produto.startsWith('(não mapeado'))
      .map(p => ({ productId: p.productId, hotmartName: p.hotmartName, vendas: p.vendas, liquido: p.liqCommissions }))

    res.json({
      month: `${y}-${String(m).padStart(2, '0')}`,
      totalTransactions: hist.length,
      totalLiquido: { commissions: round(totalComm), heuristica: round(totalHeur), diff: round(totalComm - totalHeur) },
      transacoesSemCommissionPRODUCER: txSemComm,
      naoMapeados,
      produtos,
      bucoOfertas: [...bucoOffers.entries()].map(([k, v]) => ({ oferta: k, vendas: v.vendas, liquido: round(v.liq) })).sort((a, b) => b.liquido - a.liquido),
    })
  } catch (err) {
    console.error('diag-commissions error:', err)
    res.status(500).json({ error: (err as Error).message })
  }
}
