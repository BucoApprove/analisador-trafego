/**
 * Cron job: atualiza o cache do relatório de metas mensais no Supabase.
 * Roda a cada 30 minutos via Vercel Crons.
 *
 * POST /api/refresh-monthly-cache
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { authUser } from './_supabase-auth.js'

// ─── Mapeamento Hotmart → Planilha (igual ao frontend) ───────────────────────

const PRODUCT_MAP: Record<string, string[]> = {
  'Buco Approve':  ['=bucoapprove'],
  'Renovação BA':  ['renovação ba', 'renovacao ba', 'renovação buco', 'renovação de tempo'],
  'Mentoria':      ['mentoria'],
  'Planejamento':  ['planejamento'],
  'Pós Pato':      ['pós pato', 'pos pato', 'patologia oral', 'pós-graduação em patologia'],
  'Pós Anato':     ['pós anato', 'pos anato', 'anatomia de cabeça'],
  'Low tickets':   ['low ticket', 'bucoapp', 'pack', 'livro digital', 'libro digital', 'treino intensivo', 'etapa final do sistema', 'resumo:', 'questões comentadas', '500 questões'],
  'Outros':        [],
}

const PRODUTOS_FIXOS = Object.keys(PRODUCT_MAP)

function matchHotmart(hotmartName: string): string {
  const lower = hotmartName.toLowerCase().trim()
  for (const [planilhaName, keywords] of Object.entries(PRODUCT_MAP)) {
    if (planilhaName === 'Outros') continue
    for (const k of keywords) {
      if (k.startsWith('=')) { if (lower === k.slice(1)) return planilhaName }
      else { if (lower.includes(k)) return planilhaName }
    }
  }
  return 'Outros'
}

// ─── Hotmart OAuth ────────────────────────────────────────────────────────────

async function getHotmartToken(): Promise<string> {
  const clientId     = process.env.HOTMART_CLIENT_ID ?? ''
  const clientSecret = process.env.HOTMART_CLIENT_SECRET ?? ''
  if (!clientId || !clientSecret) throw new Error('HOTMART_CLIENT_ID / HOTMART_CLIENT_SECRET não configurados')
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const resp = await fetch(
    'https://api-sec-vlc.hotmart.com/security/oauth/token?grant_type=client_credentials',
    { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' } },
  )
  if (!resp.ok) throw new Error(`Hotmart OAuth ${resp.status}`)
  const data = await resp.json() as { access_token?: string }
  if (!data.access_token) throw new Error('access_token ausente')
  return data.access_token
}

interface HotmartItem {
  product?: { id: number; name: string }
  purchase?: {
    price?: { value: number; currency_code?: string }
    hotmart_fee?: { base: number; total: number }
    transaction?: string
    status?: string
  }
  transaction?: string
}

async function fetchHotmartSales(month: string): Promise<{ byProduct: Record<string, number>; grandTotal: number; totalTransactions: number }> {
  const [y, m] = month.split('-').map(Number)
  const startMs = new Date(y, m - 1, 1, 0, 0, 0, 0).getTime()
  const endMs   = new Date(y, m, 0, 23, 59, 59, 999).getTime()
  const accessToken = await getHotmartToken()

  async function fetchByStatus(status: string): Promise<HotmartItem[]> {
    const items: HotmartItem[] = []
    let nextPageToken: string | undefined
    do {
      const url = new URL('https://developers.hotmart.com/payments/api/v1/sales/history')
      url.searchParams.set('transaction_status', status)
      url.searchParams.set('start_date', String(startMs))
      url.searchParams.set('end_date', String(endMs))
      url.searchParams.set('max_results', '500')
      if (nextPageToken) url.searchParams.set('page_token', nextPageToken)
      const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } })
      if (!resp.ok) throw new Error(`Hotmart API ${resp.status} (${status})`)
      const data = await resp.json() as { items?: HotmartItem[]; page_info?: { next_page_token?: string } }
      items.push(...(data.items ?? []))
      nextPageToken = data.page_info?.next_page_token
    } while (nextPageToken)
    return items
  }

  const [approved, complete] = await Promise.all([fetchByStatus('APPROVED'), fetchByStatus('COMPLETE')])
  const seen = new Set<string>()
  const all: HotmartItem[] = []
  for (const item of [...approved, ...complete]) {
    const tx = (item.purchase?.transaction ?? item.transaction ?? '') as string
    if (tx && seen.has(tx)) continue
    if (tx) seen.add(tx)
    all.push(item)
  }

  const byProduct: Record<string, number> = {}
  for (const item of all) {
    const currency = (item.purchase?.price as { currency_code?: string })?.currency_code ?? 'BRL'
    if (currency !== 'BRL') continue
    const name = item.product?.name ?? 'Desconhecido'
    const base = item.purchase?.hotmart_fee?.base ?? item.purchase?.price?.value ?? 0
    const fee  = item.purchase?.hotmart_fee?.total ?? 0
    const nameLower = name.toLowerCase()
    const hasExtraFee = !nameLower.includes('pack') && !nameLower.includes('mentoria') && !nameLower.includes('renova')
    const value = base - fee - (hasExtraFee ? 2.19 : 0)
    const planilhaName = matchHotmart(name)
    byProduct[planilhaName] = (byProduct[planilhaName] ?? 0) + value
  }

  const grandTotal = Object.values(byProduct).reduce((s, v) => s + v, 0)
  return { byProduct, grandTotal: Math.round(grandTotal * 100) / 100, totalTransactions: all.length }
}

// ─── Google Sheets metas ──────────────────────────────────────────────────────

function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const cols: string[] = []
    let current = ''
    let inQuotes = false
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes }
      else if (ch === ',' && !inQuotes) { cols.push(current.trim()); current = '' }
      else { current += ch }
    }
    cols.push(current.trim())
    rows.push(cols)
  }
  return rows
}

function parseBRL(val: string): number {
  if (!val) return 0
  return parseFloat(val.replace(/R\$\s*/g, '').replace(/\./g, '').replace(',', '.').trim()) || 0
}

async function fetchMonthlyGoals(month: string): Promise<{ goals: Record<string, number>; totalMeta: number; configured: boolean }> {
  const sheetId = process.env.GOALS_SHEET_ID ?? '2PACX-1vRPO_lWvVNkOao5LF3BYLTUFeJqBOdDC9zx2sXgWR37R2MPKK3oGGfc8X63EDCVJz6JN-HqN6JIuSO2'
  const gidsRaw = process.env.GOALS_SHEET_GIDS ?? '{}'
  let gids: Record<string, string> = {}
  try { gids = JSON.parse(gidsRaw) } catch { /* usa vazio */ }

  const gid = gids[month]
  if (!gid && gid !== '0') {
    return { goals: {}, totalMeta: 0, configured: false }
  }

  const csvUrl = `https://docs.google.com/spreadsheets/d/e/${sheetId}/pub?output=csv&gid=${gid}`
  const response = await fetch(csvUrl)
  if (!response.ok) throw new Error(`Sheet fetch failed: ${response.status}`)
  const text = await response.text()
  const rows = parseCSV(text)

  const goalsMap: Record<string, number> = {}
  let headerFound = false
  for (const row of rows) {
    const first = row[0]?.trim().toUpperCase()
    if (!headerFound) { if (first === 'PRODUTO') { headerFound = true } continue }
    if (!first || first === 'TOTAL') continue
    const prodName = row[0]?.trim()
    const metaVal  = parseBRL(row[1] ?? '')
    if (prodName) goalsMap[prodName] = metaVal
  }

  const goals: Record<string, number> = {}
  let totalMeta = 0
  for (const name of PRODUTOS_FIXOS) {
    goals[name] = goalsMap[name] ?? 0
    totalMeta += goals[name]
  }
  return { goals, totalMeta, configured: true }
}

// ─── Formatação ───────────────────────────────────────────────────────────────

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function progressEmoji(pct: number): string {
  if (pct >= 100) return '✅'
  if (pct >= 70) return '🟡'
  return '🔴'
}

function daysLeftInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  const today = new Date()
  const lastDay = new Date(y, m, 0).getDate()
  const todayDay = today.getFullYear() === y && today.getMonth() + 1 === m ? today.getDate() : lastDay
  return Math.max(lastDay - todayDay + 1, 1)
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Aceita chamada do cron (sem token) ou do dashboard (Bearer Supabase)
  const hasBearerToken = (req.headers.authorization ?? '').startsWith('Bearer ')
  if (hasBearerToken) {
    const user = await authUser(req, res)
    if (!user) return
  }

  const supabase = createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_KEY ?? '',
    { auth: { persistSession: false } },
  )

  const now = new Date()
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  try {
    const [goalsResult, salesResult] = await Promise.all([
      fetchMonthlyGoals(month),
      fetchHotmartSales(month),
    ])

    const { goals, totalMeta, configured } = goalsResult
    const { byProduct, grandTotal, totalTransactions } = salesResult

    const pctGeral = totalMeta > 0 ? Math.round((grandTotal / totalMeta) * 100) : 0
    const diasRestantes = daysLeftInMonth(month)
    const restante = Math.max(totalMeta - grandTotal, 0)
    const metaPorDia = diasRestantes > 0 ? restante / diasRestantes : 0

    const [ano, mes] = month.split('-')
    const nomeMes = new Date(Number(ano), Number(mes) - 1).toLocaleString('pt-BR', { month: 'long' })
    const nomeMesCap = nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1)

    // Linhas por produto (apenas os que têm meta ou faturamento)
    const linhasProdutos = PRODUTOS_FIXOS
      .map(name => {
        const meta      = goals[name] ?? 0
        const faturado  = Math.round((byProduct[name] ?? 0) * 100) / 100
        if (meta === 0 && faturado === 0) return null
        const pct = meta > 0 ? Math.round((faturado / meta) * 100) : null
        const pctStr = pct !== null ? ` (${pct}%)` : ''
        return `• ${name}: ${fmtBRL(faturado)}${meta > 0 ? ` / ${fmtBRL(meta)}${pctStr}` : ''}`
      })
      .filter(Boolean)
      .join('\n')

    const parte1 = `📅 *Metas de ${nomeMesCap}*\n\n*Por produto:*\n${linhasProdutos || '_Sem dados_'}`

    const parte2 = configured
      ? `*Total faturado:* ${fmtBRL(grandTotal)}\n*Meta total:* ${fmtBRL(totalMeta)}\n*Progresso:* ${pctGeral}% ${progressEmoji(pctGeral)}`
      : `*Total faturado:* ${fmtBRL(grandTotal)}\n_Metas não configuradas para este mês._`

    const parte3 = configured && restante > 0
      ? `*Restante:* ${fmtBRL(restante)}\n*Meta/dia:* ${fmtBRL(metaPorDia)}\n*Dias restantes:* ${diasRestantes}\n*Vendas no mês:* ${totalTransactions}`
      : `*Vendas no mês:* ${totalTransactions}`

    const payload = {
      parte1, parte2, parte3,
      month, grandTotal, totalMeta, pctGeral,
      totalTransactions, diasRestantes,
      updatedAt: new Date().toISOString(),
    }

    await supabase.from('report_cache').upsert({ key: 'manychat-monthly', value: payload })

    res.json({ ok: true, updatedAt: payload.updatedAt })
  } catch (err) {
    console.error('refresh-monthly-cache error:', err)
    res.status(500).json({ error: (err as Error).message })
  }
}
