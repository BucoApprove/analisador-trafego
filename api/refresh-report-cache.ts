/**
 * Cron job: atualiza o cache do relatório ManyChat no Supabase.
 * Roda a cada 15 minutos via Vercel Crons.
 *
 * POST /api/refresh-report-cache
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { bqQuery, tableLeads } from './_bq.js'

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function firstOfMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function normalizeDateStr(s: string): string {
  if (!s) return ''
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s.trim())) {
    const [d, m, y] = s.trim().split('/')
    return `${y}-${m}-${d}`
  }
  return s.trim()
}

function fmt(n: number): string {
  return n.toLocaleString('pt-BR')
}

function progressEmoji(pct: number): string {
  if (pct >= 100) return '✅'
  if (pct >= 70) return '🟡'
  return '🔴'
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

async function fetchGoals() {
  const sheetId = process.env.GOALS_SHEET_ID ?? '1X6ZHXlvJF_BJl2ammeI1ud4GVtXYBQolqemR8Hi374I'
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Falha ao buscar planilha: ${response.status}`)
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
    },
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_KEY ?? '',
    { auth: { persistSession: false } },
  )

  try {
    const goals = await fetchGoals()
    const lancamento = goals.tagsReferencia.lancamento
    if (!lancamento) throw new Error('Tag de lançamento não encontrada na planilha.')

    const since = normalizeDateStr(goals.inicioCaptacao) || firstOfMonthStr()
    const until = todayStr()
    const tLeads = tableLeads()
    const pattern = `%${lancamento}%`

    const [byTagResult, totalResult] = await Promise.all([
      bqQuery(
        `SELECT tag_name, COUNT(DISTINCT lead_email) AS total
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

    const metaTotal = goals.metaLeadsTrafico + goals.metaLeadsOrganico + goals.metaLeadsManychat
    const pctTotal = metaTotal > 0 ? Math.round((totalUnicos / metaTotal) * 100) : 0

    const dataInicio = since.split('-').reverse().join('/')
    const dataHoje = until.split('-').reverse().join('/')

    const linhasLeads = leadsByTag.length > 0
      ? leadsByTag.map((l) => `• ${l.tag}: *${fmt(l.total)}*`).join('\n')
      : '• Nenhum lead encontrado.'

    const linhasMetas = [
      goals.metaLeadsTrafico > 0 ? `• Tráfego: *${fmt(goals.metaLeadsTrafico)}*` : null,
      goals.metaLeadsOrganico > 0 ? `• Orgânico: *${fmt(goals.metaLeadsOrganico)}*` : null,
      goals.metaLeadsManychat > 0 ? `• ManyChat: *${fmt(goals.metaLeadsManychat)}*` : null,
    ].filter(Boolean).join('\n')

    const parte1 = `📊 *Relatório – ${lancamento}*\n📅 ${dataInicio} até ${dataHoje}\n\n*Leads por fase:*\n${linhasLeads}`
    const parte2 = `*Total único:* ${fmt(totalUnicos)} leads`
    const parte3 = metaTotal > 0
      ? `*Meta:* ${fmt(metaTotal)} leads\n${linhasMetas}\n\n*Progresso:* ${pctTotal}% ${progressEmoji(pctTotal)}\n_(${fmt(totalUnicos)} de ${fmt(metaTotal)})_`
      : `_Metas não configuradas._`

    const payload = { parte1, parte2, parte3, lancamento, totalUnicos, leadsByTag, updatedAt: new Date().toISOString() }

    await supabase.from('report_cache').upsert({ key: 'manychat-report', value: payload })

    res.json({ ok: true, updatedAt: payload.updatedAt })
  } catch (err) {
    console.error('refresh-report-cache error:', err)
    res.status(500).json({ error: (err as Error).message })
  }
}
