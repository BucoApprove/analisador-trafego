/**
 * Endpoint para o ManyChat buscar o relatório do lançamento.
 *
 * Auth: header  x-api-key: {MANYCHAT_API_KEY}
 *
 * GET /api/manychat-report
 *
 * Retorna JSON com o campo `mensagem` contendo o texto formatado
 * para WhatsApp que o ManyChat pode enviar direto ao usuário.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { bqQuery, tableLeads } from './_bq.js'

// ─── Helpers de data ──────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function firstOfMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/** Converte "DD/MM/YYYY" ou "YYYY-MM-DD" para "YYYY-MM-DD". */
function normalizeDateStr(s: string): string {
  if (!s) return ''
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s.trim())) {
    const [d, m, y] = s.trim().split('/')
    return `${y}-${m}-${d}`
  }
  return s.trim()
}

/** Formata número com separador de milhar em pt-BR. */
function fmt(n: number): string {
  return n.toLocaleString('pt-BR')
}

/** Emoji de progresso baseado no percentual atingido. */
function progressEmoji(pct: number): string {
  if (pct >= 100) return '✅'
  if (pct >= 70) return '🟡'
  return '🔴'
}

// ─── Busca metas da planilha Google Sheets ────────────────────────────────────

interface Goals {
  metaLeadsTrafico: number
  metaLeadsOrganico: number
  metaLeadsManychat: number
  inicioCaptacao: string
  finalCaptacao: string
  tagsReferencia: {
    lancamento: string
    captura: string
    descoberta: string
    aquecimento: string
    lembrete: string
    remarketing: string
  }
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

async function fetchGoals(): Promise<Goals> {
  const sheetId = process.env.GOALS_SHEET_ID ?? '1X6ZHXlvJF_BJl2ammeI1ud4GVtXYBQolqemR8Hi374I'
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`

  const response = await fetch(url)
  if (!response.ok) throw new Error(`Falha ao buscar planilha de metas: ${response.status}`)
  const csv = await response.text()

  const map: Record<string, string> = {}
  for (const line of csv.split('\n')) {
    const cols = parseCSVRow(line)
    if (cols[0] && cols[1]) map[cols[0]] = cols[1]
  }

  return {
    metaLeadsTrafico: parseInt(map['META LEADS TRÁFEGO'] ?? '0') || 0,
    metaLeadsOrganico: parseInt(map['META LEADS ORGÂNICO'] ?? '0') || 0,
    metaLeadsManychat: parseInt(map['META LEADS MANYCHAT'] ?? '0') || 0,
    inicioCaptacao: map['INÍCIO DA CAPTURA'] ?? '',
    finalCaptacao: map['FINAL DA CAPTURA'] ?? '',
    tagsReferencia: {
      lancamento: map['LANÇAMENTO'] ?? '',
      captura:    map['CAPTURA']    ?? '',
      descoberta: map['DESCOBERTA'] ?? '',
      aquecimento: map['AQUECIMENTO'] ?? '',
      lembrete:   map['LEMBRETE']   ?? '',
      remarketing: map['REMARKETING'] ?? '',
    },
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ── Autenticação via API key simples ──────────────────────────────────────
  const expectedKey = process.env.MANYCHAT_API_KEY
  if (!expectedKey) {
    res.status(500).json({ error: 'MANYCHAT_API_KEY não configurada no servidor.' })
    return
  }
  const providedKey = req.headers['x-api-key']
  if (providedKey !== expectedKey) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')

  try {
    // ── 1. Busca metas + tags de referência ───────────────────────────────
    const goals = await fetchGoals()

    const lancamento = goals.tagsReferencia.lancamento
    if (!lancamento) {
      res.status(500).json({ error: 'Tag de lançamento não encontrada na planilha de metas.' })
      return
    }

    const since = normalizeDateStr(goals.inicioCaptacao) || firstOfMonthStr()
    const until = todayStr()

    // ── 2. Leads por tag no BigQuery ──────────────────────────────────────
    const tLeads = tableLeads()
    const pattern = `%${lancamento}%`

    const [byTagResult, totalResult] = await Promise.all([
      bqQuery(
        `SELECT
           tag_name,
           COUNT(DISTINCT lead_email) AS total
         FROM ${tLeads}
         WHERE tag_name LIKE @pattern
           AND DATE(lead_register) BETWEEN @since AND @until
         GROUP BY tag_name
         ORDER BY total DESC`,
        [
          { name: 'pattern', value: pattern },
          { name: 'since', value: since },
          { name: 'until', value: until },
        ],
      ),
      bqQuery(
        `SELECT COUNT(DISTINCT lead_email) AS total
         FROM ${tLeads}
         WHERE tag_name LIKE @pattern
           AND DATE(lead_register) BETWEEN @since AND @until`,
        [
          { name: 'pattern', value: pattern },
          { name: 'since', value: since },
          { name: 'until', value: until },
        ],
      ),
    ])

    const leadsByTag = byTagResult.rows.map((r) => ({
      tag: r.tag_name ?? '',
      total: parseInt(r.total ?? '0'),
    }))

    const totalUnicos = parseInt(totalResult.rows[0]?.total ?? '0')

    // ── 3. Metas ──────────────────────────────────────────────────────────
    const metaTotal =
      goals.metaLeadsTrafico + goals.metaLeadsOrganico + goals.metaLeadsManychat
    const pctTotal = metaTotal > 0 ? Math.round((totalUnicos / metaTotal) * 100) : 0

    // ── 4. Monta a mensagem formatada para WhatsApp ───────────────────────
    const dataInicio = since
      ? since.split('-').reverse().join('/')   // YYYY-MM-DD → DD/MM/YYYY
      : '—'
    const dataHoje = until.split('-').reverse().join('/')

    const linhasLeads = leadsByTag.length > 0
      ? leadsByTag.map((l) => `• ${l.tag}: *${fmt(l.total)}*`).join('\n')
      : '• Nenhum lead encontrado para este lançamento.'

    const linhasMetas = [
      goals.metaLeadsTrafico > 0
        ? `• Tráfego pago: *${fmt(goals.metaLeadsTrafico)}* leads`
        : null,
      goals.metaLeadsOrganico > 0
        ? `• Orgânico: *${fmt(goals.metaLeadsOrganico)}* leads`
        : null,
      goals.metaLeadsManychat > 0
        ? `• ManyChat: *${fmt(goals.metaLeadsManychat)}* leads`
        : null,
    ]
      .filter(Boolean)
      .join('\n')

    // Separado em partes para respeitar limite de 255 chars dos campos ManyChat
    const parte1 = `📊 *Relatório – ${lancamento}*\n📅 ${dataInicio} até ${dataHoje}\n\n*Leads por fase:*\n${linhasLeads}`

    const parte2 = `*Total único:* ${fmt(totalUnicos)} leads`

    const parte3 = metaTotal > 0
      ? `*Meta:* ${fmt(metaTotal)} leads\n${linhasMetas}\n\n*Progresso:* ${pctTotal}% ${progressEmoji(pctTotal)}\n_(${fmt(totalUnicos)} de ${fmt(metaTotal)})_`
      : `_Metas não configuradas._`

    const mensagem = `${parte1}\n\n${parte2}\n\n${parte3}`

    // ── 5. Resposta JSON ─────────────────────────────────────────────────
    res.json({
      mensagem,
      parte1,
      parte2,
      parte3,
      dados: {
        lancamento,
        periodo: { desde: since, ate: until },
        totalUnicos,
        leadsByTag,
        metas: {
          trafico: goals.metaLeadsTrafico,
          organico: goals.metaLeadsOrganico,
          manychat: goals.metaLeadsManychat,
          total: metaTotal,
          percentualAtingido: pctTotal,
        },
      },
    })
  } catch (err) {
    console.error('manychat-report error:', err)
    res.status(500).json({ error: 'Erro interno ao gerar relatório.' })
  }
}
