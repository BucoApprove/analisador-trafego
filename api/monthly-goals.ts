/**
 * Busca metas mensais da planilha Google Sheets publicada.
 *
 * A planilha tem uma aba por mês (ex: ABRIL, MARÇO, FEV).
 * Cada aba tem colunas: PRODUTO, META
 *
 * Env vars (Vercel):
 *   GOALS_SHEET_ID — ID da planilha publicada
 *     ex: 2PACX-1vRPO_lWvVNkOao5LF3BYLTUFeJqBOdDC9zx2sXgWR37R2MPKK3oGGfc8X63EDCVJz6JN-HqN6JIuSO2
 *   GOALS_SHEET_GIDS — JSON mapeando "YYYY-MM" → gid da aba
 *     ex: {"2026-02":"0","2026-03":"123456","2026-04":"789012"}
 *
 * Query params:
 *   month — YYYY-MM
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'

function auth(req: VercelRequest, res: VercelResponse): boolean {
  const header = req.headers.authorization ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  const ok =
    (provided && provided === process.env.DASHBOARD_TOKEN_ADMIN) ||
    (provided && provided === process.env.DASHBOARD_TOKEN)
  if (!ok) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

function parseBRL(val: string): number {
  if (!val) return 0
  return parseFloat(val.replace(/R\$\s*/g, '').replace(/\./g, '').replace(',', '.').trim()) || 0
}

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

// Produtos fixos na ordem da planilha
export const PRODUTOS_FIXOS = [
  'Buco Approve',
  'Renovação BA',
  'Mentoria',
  'Planejamento',
  'Pós Pato',
  'Pós Anato',
  'Low tickets',
  'Outros',
]

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!auth(req, res)) return

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')

  const monthParam = typeof req.query.month === 'string' ? req.query.month : ''
  const now = new Date()
  const month = monthParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const sheetId = process.env.GOALS_SHEET_ID ?? '2PACX-1vRPO_lWvVNkOao5LF3BYLTUFeJqBOdDC9zx2sXgWR37R2MPKK3oGGfc8X63EDCVJz6JN-HqN6JIuSO2'
  const gidsRaw = process.env.GOALS_SHEET_GIDS ?? '{}'
  let gids: Record<string, string> = {}
  try { gids = JSON.parse(gidsRaw) } catch { /* usa vazio */ }

  const gid = gids[month]
  if (!gid && gid !== '0') {
    // Sem gid configurado — retorna produtos com meta 0
    return res.json({
      month,
      goals: PRODUTOS_FIXOS.map(name => ({ name, meta: 0 })),
      configured: false,
    })
  }

  try {
    const csvUrl = `https://docs.google.com/spreadsheets/d/e/${sheetId}/pub?output=csv&gid=${gid}`
    const response = await fetch(csvUrl)
    if (!response.ok) throw new Error(`Sheet fetch failed: ${response.status}`)

    const text = await response.text()
    const rows = parseCSV(text)

    // Encontra linha de cabeçalho e monta mapa produto → meta
    const goalsMap = new Map<string, number>()
    let headerFound = false

    for (const row of rows) {
      const first = row[0]?.trim().toUpperCase()
      if (!headerFound) {
        if (first === 'PRODUTO') { headerFound = true }
        continue
      }
      if (!first || first === 'TOTAL') continue
      const prodName = row[0]?.trim()
      const metaVal  = parseBRL(row[1] ?? '')
      if (prodName) goalsMap.set(prodName, metaVal)
    }

    const goals = PRODUTOS_FIXOS.map(name => ({
      name,
      meta: goalsMap.get(name) ?? 0,
    }))

    const totalMeta = goals.reduce((s, g) => s + g.meta, 0)

    res.json({ month, goals, totalMeta, configured: true })
  } catch (err) {
    console.error('monthly-goals error:', err)
    res.status(500).json({ error: 'Erro interno', detail: (err as Error).message })
  }
}
