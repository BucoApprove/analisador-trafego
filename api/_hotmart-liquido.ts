/**
 * Busca vendas da Hotmart com FATURAMENTO LÍQUIDO real (comissão PRODUCER).
 *
 * Fonte de verdade do líquido = sales/commissions (source=PRODUCER), cruzado
 * por transaction com sales/history. Validado em junho/2026: 0 transações sem
 * comissão PRODUCER, e mais preciso que a heurística base-fee-2.19 (que erra
 * R$2,19/venda nos produtos de baixo ticket).
 *
 * Agrupa pelo produto canônico (api/_produtos-db.ts) e expõe o
 * drill-down de ofertas do BucoApprove.
 */
import { classifyProduto, getBucoPid, type Categoria } from './_produtos-db.js'
import { fetchOfertaNomes } from './_hotmart-ofertas.js'

export interface ProdutoVendas {
  nome: string
  categoria: Categoria
  vendas: number
  liquido: number
  ofertas?: { code: string; nome: string; vendas: number; liquido: number }[]  // só BucoApprove/Intensivo
}

export interface HotmartLiquido {
  produtos: ProdutoVendas[]
  totalLiquido: number
  totalVendas: number
  porCategoria: Record<Categoria, number>
}

async function getToken(): Promise<string> {
  const cid = process.env.HOTMART_CLIENT_ID ?? ''
  const csec = process.env.HOTMART_CLIENT_SECRET ?? ''
  if (!cid || !csec) throw new Error('HOTMART_CLIENT_ID / HOTMART_CLIENT_SECRET ausentes')
  const basic = Buffer.from(`${cid}:${csec}`).toString('base64')
  const r = await fetch('https://api-sec-vlc.hotmart.com/security/oauth/token?grant_type=client_credentials', {
    method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
  })
  if (!r.ok) throw new Error(`Hotmart OAuth ${r.status}`)
  const d = await r.json() as { access_token?: string }
  if (!d.access_token) throw new Error('Hotmart OAuth: sem access_token')
  return d.access_token
}

interface SaleItem {
  product?: { id: number; name: string }
  purchase?: { transaction?: string; offer?: { code?: string }; price?: { currency_code?: string }; order_date?: number; approved_date?: number }
  transaction?: string
}

async function paginate<T>(url: string, token: string): Promise<T[]> {
  const out: T[] = []
  let pageToken: string | undefined
  for (let i = 0; i < 80; i++) {
    const u = new URL(url)
    if (pageToken) u.searchParams.set('page_token', pageToken)
    const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
    if (!r.ok) throw new Error(`${u.pathname} → ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const d = await r.json() as { items?: T[]; page_info?: { next_page_token?: string } }
    out.push(...(d.items ?? []))
    pageToken = d.page_info?.next_page_token
    if (!pageToken) break
  }
  return out
}

const round = (n: number) => Math.round(n * 100) / 100

/** Busca vendas + líquido (commissions PRODUCER) de um mês "YYYY-MM" (ou range). */
export async function fetchHotmartLiquido(month: string, range?: { since: string; until: string }): Promise<HotmartLiquido> {
  const [y, m] = month.split('-').map(Number)
  const startMs = range?.since
    ? new Date(`${range.since}T00:00:00`).getTime()
    : new Date(y, m - 1, 1, 0, 0, 0, 0).getTime()
  const endMs = range?.until
    ? new Date(`${range.until}T23:59:59`).getTime()
    : new Date(y, m, 0, 23, 59, 59, 999).getTime()
  const [token, BUCO_PID] = await Promise.all([getToken(), getBucoPid()])
  const base = `start_date=${startMs}&end_date=${endMs}&max_results=50`

  // Líquido por transaction (PRODUCER)
  const commItems = await paginate<{ transaction?: string; commissions?: Array<{ source?: string; commission?: { value?: number } }> }>(
    `https://developers.hotmart.com/payments/api/v1/sales/commissions?${base}`, token,
  )
  const producerByTx = new Map<string, number>()
  for (const it of commItems) {
    for (const c of it.commissions ?? []) {
      if (c.source === 'PRODUCER' && it.transaction) producerByTx.set(it.transaction, c.commission?.value ?? 0)
    }
  }

  // Vendas (APPROVED + COMPLETE) deduplicadas por transaction
  const [appr, compl] = await Promise.all([
    paginate<SaleItem>(`https://developers.hotmart.com/payments/api/v1/sales/history?transaction_status=APPROVED&${base}`, token),
    paginate<SaleItem>(`https://developers.hotmart.com/payments/api/v1/sales/history?transaction_status=COMPLETE&${base}`, token),
  ])
  const seen = new Set<string>()
  const hist: SaleItem[] = []
  for (const it of [...appr, ...compl]) {
    const tx = it.purchase?.transaction ?? it.transaction ?? ''
    if (tx && seen.has(tx)) continue
    if (tx) seen.add(tx)
    hist.push(it)
  }

  // Nomes das ofertas do BucoApprove (code → nome legível), em paralelo.
  const ofertaNomesPromise = fetchOfertaNomes(BUCO_PID, token)

  const byCanon = new Map<string, ProdutoVendas>()
  // produtoCanonico = a qual linha a oferta pertence (Buco Approve / Intensivo ENARE)
  const bucoOffers = new Map<string, { code: string; produtoCanonico: string; vendas: number; liquido: number }>()
  let totalLiquido = 0, totalVendas = 0
  const porCategoria: Record<Categoria, number> = { core: 0, porta: 0, low: 0 }

  for (const it of hist) {
    if ((it.purchase?.price?.currency_code ?? 'BRL') !== 'BRL') continue
    const tx = it.purchase?.transaction ?? it.transaction ?? ''
    const liq = producerByTx.get(tx) ?? 0
    const pid = it.product?.id ?? 0
    const offer = it.purchase?.offer?.code

    const canon = await classifyProduto(pid, offer)
    const row = byCanon.get(canon.nome) ?? { nome: canon.nome, categoria: canon.categoria, vendas: 0, liquido: 0 }
    row.vendas++; row.liquido += liq
    byCanon.set(canon.nome, row)

    totalLiquido += liq; totalVendas++; porCategoria[canon.categoria] += liq

    if (pid === BUCO_PID) {
      const code = offer ?? '(sem code)'
      const o = bucoOffers.get(code) ?? { code, produtoCanonico: canon.nome, vendas: 0, liquido: 0 }
      o.vendas++; o.liquido += liq
      bucoOffers.set(code, o)
    }
  }

  // Anexa drill-down de ofertas (com nome legível) nos produtos do Buco.
  const ofertaNomes = await ofertaNomesPromise
  for (const o of bucoOffers.values()) {
    const target = byCanon.get(o.produtoCanonico)
    if (!target) continue
    ;(target.ofertas ??= []).push({
      code: o.code,
      nome: ofertaNomes[o.code] || o.code,  // fallback para o code se a API não trouxe o nome
      vendas: o.vendas,
      liquido: round(o.liquido),
    })
  }

  const produtos = [...byCanon.values()]
    .map(p => ({ ...p, liquido: round(p.liquido), ofertas: p.ofertas?.sort((a, b) => b.liquido - a.liquido) }))
    .sort((a, b) => b.liquido - a.liquido)

  return {
    produtos,
    totalLiquido: round(totalLiquido),
    totalVendas,
    porCategoria: { core: round(porCategoria.core), porta: round(porCategoria.porta), low: round(porCategoria.low) },
  }
}

/**
 * Vendas + líquido por produto canônico num intervalo de datas (since/until,
 * "YYYY-MM-DD"). Conta TODAS as vendas por product_id — independente de lead.
 * Usado pelo detalhe do lançamento (vendas reais vs meta, incl. compra direta).
 *
 * Retorna mapa { nomeCanonico → { vendas, liquido } } e, em paralelo, o mesmo
 * agregado por product_id bruto (totaisPorId) — usar por id evita qualquer
 * mismatch de string entre o nome canônico cadastrado e o nome usado no
 * frontend para buscar no mapa.
 */
export async function fetchVendasPorProdutoRange(
  since: string,
  until: string,
): Promise<{
  totais: Record<string, { vendas: number; liquido: number }>
  totaisPorId: Record<number, { vendas: number; liquido: number }>
  diario: Record<string, Record<string, number>>  // nome → { 'YYYY-MM-DD': vendas }
  diarioPorId: Record<number, Record<string, number>>  // product_id → { 'YYYY-MM-DD': vendas }
}> {
  const startMs = new Date(`${since}T00:00:00`).getTime()
  const endMs = new Date(`${until}T23:59:59`).getTime()
  const token = await getToken()
  const base = `start_date=${startMs}&end_date=${endMs}&max_results=50`

  const commItems = await paginate<{ transaction?: string; commissions?: Array<{ source?: string; commission?: { value?: number } }> }>(
    `https://developers.hotmart.com/payments/api/v1/sales/commissions?${base}`, token,
  )
  const producerByTx = new Map<string, number>()
  for (const it of commItems) {
    for (const c of it.commissions ?? []) {
      if (c.source === 'PRODUCER' && it.transaction) producerByTx.set(it.transaction, c.commission?.value ?? 0)
    }
  }

  const [appr, compl] = await Promise.all([
    paginate<SaleItem>(`https://developers.hotmart.com/payments/api/v1/sales/history?transaction_status=APPROVED&${base}`, token),
    paginate<SaleItem>(`https://developers.hotmart.com/payments/api/v1/sales/history?transaction_status=COMPLETE&${base}`, token),
  ])
  const seen = new Set<string>()
  const totais: Record<string, { vendas: number; liquido: number }> = {}
  const totaisPorId: Record<number, { vendas: number; liquido: number }> = {}
  const diario: Record<string, Record<string, number>> = {}
  const diarioPorId: Record<number, Record<string, number>> = {}
  for (const it of [...appr, ...compl]) {
    const tx = it.purchase?.transaction ?? it.transaction ?? ''
    if (tx && seen.has(tx)) continue
    if (tx) seen.add(tx)
    if ((it.purchase?.price?.currency_code ?? 'BRL') !== 'BRL') continue
    const pid = it.product?.id ?? 0
    const liquidoVenda = producerByTx.get(tx) ?? 0
    const canon = await classifyProduto(pid, it.purchase?.offer?.code)
    const row = totais[canon.nome] ?? { vendas: 0, liquido: 0 }
    row.vendas++; row.liquido += liquidoVenda
    totais[canon.nome] = row
    const rowId = totaisPorId[pid] ?? { vendas: 0, liquido: 0 }
    rowId.vendas++; rowId.liquido += liquidoVenda
    totaisPorId[pid] = rowId
    // quebra diária pela data da compra (order_date; fallback approved_date)
    const ts = it.purchase?.order_date ?? it.purchase?.approved_date
    if (ts) {
      const dia = new Date(ts).toISOString().slice(0, 10)
      ;(diario[canon.nome] ??= {})[dia] = (diario[canon.nome][dia] ?? 0) + 1
      ;(diarioPorId[pid] ??= {})[dia] = (diarioPorId[pid][dia] ?? 0) + 1
    }
  }
  for (const k of Object.keys(totais)) totais[k].liquido = round(totais[k].liquido)
  for (const k of Object.keys(totaisPorId)) totaisPorId[Number(k)].liquido = round(totaisPorId[Number(k)].liquido)
  return { totais, totaisPorId, diario, diarioPorId }
}
