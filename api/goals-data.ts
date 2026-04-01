import type { VercelRequest, VercelResponse } from '@vercel/node'

const SHEET_ID = '1X6ZHXlvJF_BJl2ammeI1ud4GVtXYBQolqemR8Hi374I'
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`

function auth(req: VercelRequest, res: VercelResponse): boolean {
  const token = process.env.DASHBOARD_TOKEN
  const header = req.headers.authorization ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!provided || (provided !== token && provided !== process.env.DASHBOARD_TOKEN_ADMIN)) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

function parseCSVRow(row: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (const char of row) {
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim())
  return result
}

function parseBRL(val: string): number {
  return parseFloat(val.replace('R$', '').replace(/\./g, '').replace(',', '.').trim()) || 0
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!auth(req, res)) return

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')

  try {
    const response = await fetch(CSV_URL)
    if (!response.ok) throw new Error(`Falha ao buscar planilha: ${response.status}`)
    const csv = await response.text()

    const map: Record<string, string> = {}
    for (const line of csv.split('\n')) {
      const cols = parseCSVRow(line)
      if (cols[0] && cols[1]) map[cols[0]] = cols[1]
    }

    const goals = {
      metaLeadsTrafico: parseInt(map['META LEADS TRÁFEGO'] ?? '0') || 0,
      metaLeadsOrganico: parseInt(map['META LEADS ORGÂNICO'] ?? '0') || 0,
      metaLeadsManychat: parseInt(map['META LEADS MANYCHAT'] ?? '0') || 0,
      orcamentoTotal: parseBRL(map['ORÇAMENTO TOTAL TRÁFEGO'] ?? '0'),
      inicioCaptacao: map['INÍCIO DA CAPTURA'] ?? '',
      finalCaptacao: map['FINAL DA CAPTURA'] ?? '',
      orcamentoPorFase: {
        captura: parseBRL(map['ORÇAMENTO CAPTURA'] ?? '0'),
        descoberta: parseBRL(map['ORÇAMENTO DESCOBERTA'] ?? '0'),
        aquecimento: parseBRL(map['ORÇAMENTO AQUECIMENTO'] ?? '0'),
        lembrete: parseBRL(map['ORÇAMENTO LEMBRETE'] ?? '0'),
        remarketing: parseBRL(map['ORÇAMENTO REMARKETING'] ?? '0'),
      },
      tagsReferencia: {
        lancamento: map['LANÇAMENTO'] ?? 'BA25',
        captura: map['CAPTURA'] ?? 'Captura',
        descoberta: map['DESCOBERTA'] ?? 'Instagram',
        aquecimento: map['AQUECIMENTO'] ?? 'Engajamento',
        lembrete: map['LEMBRETE'] ?? 'Lembrete',
        remarketing: map['REMARKETING'] ?? 'Remarketing',
      },
    }

    res.json(goals)
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
}
