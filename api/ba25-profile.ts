/**
 * Perfil completo dos compradores BA25:
 *   – Receita por UTM (lastBefore) → base para ROAS no frontend
 *   – Receita por fase de formação → ticket médio e CPV por fase
 *   – Matriz fase × campanha         → CPV por fase com atribuição proporcional
 *
 * Combina 3 fontes em paralelo:
 *   1. BigQuery / vendas  → todos os compradores + receita
 *   2. BigQuery / leads   → histórico de UTMs por comprador
 *   3. Google Sheets      → pesquisa de boas-vindas (email → fase)
 *
 * GET /api/ba25-profile?since=YYYY-MM-DD&until=YYYY-MM-DD
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { bqQuery, tableLeads, tableVendas } from './_bq.js'
import { authUser } from './_supabase-auth.js'

const SURVEY_SHEET_ID = '1yDxS-O0BnPk8jH8dqHZpyL1sXdxp1ABl'
const SURVEY_CSV_URL  = `https://docs.google.com/spreadsheets/d/${SURVEY_SHEET_ID}/export?format=csv`

function todayStr() { return new Date().toISOString().split('T')[0] }

function parseCSVRow(row: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (const char of row) {
    if (char === '"') { inQuotes = !inQuotes }
    else if (char === ',' && !inQuotes) { result.push(current.trim()); current = '' }
    else { current += char }
  }
  result.push(current.trim())
  return result
}

interface Entry { buyers: number; revenue: number }

function addEntry(map: Map<string, Entry>, key: string | null, revenue: number) {
  if (!key) return
  const e = map.get(key) ?? { buyers: 0, revenue: 0 }
  e.buyers++
  e.revenue += revenue
  map.set(key, e)
}

function toSortedArray(map: Map<string, Entry>) {
  return [...map.entries()]
    .map(([name, e]) => ({
      name,
      buyers:    e.buyers,
      revenue:   Math.round(e.revenue * 100) / 100,
      avgTicket: e.buyers > 0 ? Math.round((e.revenue / e.buyers) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const _user = await authUser(req, res); if (!_user) return

  const since    = typeof req.query.since === 'string' ? req.query.since : '2026-04-09'
  const until    = typeof req.query.until === 'string' ? req.query.until : todayStr()
  const emailCol = process.env.BQ_VENDAS_EMAIL_COL ?? 'E_mail_do_Comprador'
  const dateCol  = process.env.BQ_VENDAS_DATE_COL  ?? 'Data_de_Aprova____o'
  const tLeads   = tableLeads()
  const tVendas  = tableVendas()

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')

  try {
    // ── 3 fontes em paralelo ───────────────────────────────────────────────────
    const params = [
      { name: 'since', value: since },
      { name: 'until', value: until },
    ]

    const [revenueResult, utmResult, surveyRes] = await Promise.all([
      // 1. Todos os compradores + receita total
      bqQuery(`
        SELECT
          LOWER(TRIM(\`${emailCol}\`)) AS email,
          -- Valor_do_Produto = preço cheio do produto (centavos); MAX por comprador
          -- evita somar múltiplas parcelas quando o comprador parcelou
          MAX(IFNULL(Valor_do_Produto, 0)) / 100.0 AS total_revenue
        FROM ${tVendas}
        WHERE Status IN ('COMPLETO', 'APROVADO')
          AND LOWER(TRIM(Nome_do_Produto)) LIKE '%buco%approve%'
          AND \`${emailCol}\` IS NOT NULL
          AND TRIM(\`${emailCol}\`) <> ''
          AND \`${dateCol}\` >= @since
          AND \`${dateCol}\` <= @until
        GROUP BY LOWER(TRIM(\`${emailCol}\`))
      `, params),

      // 2. Histórico de UTMs dos compradores
      bqQuery(`
        WITH buyers AS (
          SELECT LOWER(TRIM(\`${emailCol}\`)) AS lead_email,
                 MIN(\`${dateCol}\`)          AS purchase_date
          FROM ${tVendas}
          WHERE Status IN ('COMPLETO', 'APROVADO')
            AND LOWER(TRIM(Nome_do_Produto)) LIKE '%buco%approve%'
            AND \`${emailCol}\` IS NOT NULL
            AND TRIM(\`${emailCol}\`) <> ''
            AND \`${dateCol}\` >= @since
            AND \`${dateCol}\` <= @until
          GROUP BY LOWER(TRIM(\`${emailCol}\`))
        )
        SELECT
          l.lead_email,
          b.purchase_date,
          DATE(l.lead_register) AS utm_date,
          l.utm_campaign,
          l.utm_medium,
          l.utm_content
        FROM ${tLeads} l
        INNER JOIN buyers b ON LOWER(TRIM(l.lead_email)) = b.lead_email
        WHERE l.utm_campaign IS NOT NULL
           OR l.utm_medium   IS NOT NULL
           OR l.utm_content  IS NOT NULL
        ORDER BY l.lead_email, DATE(l.lead_register)
      `, params),

      // 3. Planilha de pesquisa (Google Sheets CSV)
      fetch(SURVEY_CSV_URL),
    ])

    // ── Mapa email → receita ───────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const revenueMap = new Map<string, number>(
      revenueResult.rows.map((r: any) => [
        (r.email ?? '').toLowerCase().trim(),
        parseFloat(r.total_revenue ?? '0') || 0,
      ])
    )

    // ── Mapa email → lastBefore UTM  (via histórico ordenado) ─────────────────
    const utmHistory = new Map<string, { purchaseDate: string; utms: { date: string; campaign: string | null; medium: string | null; content: string | null }[] }>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of utmResult.rows as any[]) {
      const email = (row.lead_email ?? '').toLowerCase().trim()
      if (!email) continue
      if (!utmHistory.has(email)) {
        utmHistory.set(email, { purchaseDate: row.purchase_date ?? '', utms: [] })
      }
      utmHistory.get(email)!.utms.push({
        date:     row.utm_date     ?? '',
        campaign: row.utm_campaign ?? null,
        medium:   row.utm_medium   ?? null,
        content:  row.utm_content  ?? null,
      })
    }

    const lastBeforeMap = new Map<string, { campaign: string | null; medium: string | null; content: string | null }>()
    for (const [email, { purchaseDate, utms }] of utmHistory) {
      const before = utms.filter(u => u.date && u.date <= purchaseDate)
      const last   = before.length > 0 ? before[before.length - 1] : null
      lastBeforeMap.set(email, {
        campaign: last?.campaign ?? null,
        medium:   last?.medium   ?? null,
        content:  last?.content  ?? null,
      })
    }

    // ── Mapa email → fase (pesquisa) ───────────────────────────────────────────
    const phaseMap = new Map<string, string>()
    if (surveyRes.ok) {
      const csv   = await surveyRes.text()
      const lines = csv.split('\n').filter(l => l.trim())
      if (lines.length >= 2) {
        const headers  = parseCSVRow(lines[0])
        const emailIdx = headers.findIndex(h => /e.?mail/i.test(h))
        const phaseIdx = headers.findIndex(h => /fase|forma[cç][aã]o|semestre/i.test(h))
        if (emailIdx !== -1 && phaseIdx !== -1) {
          for (let i = 1; i < lines.length; i++) {
            const cols  = parseCSVRow(lines[i])
            const email = (cols[emailIdx] ?? '').toLowerCase().trim()
            const phase = (cols[phaseIdx] ?? '').trim()
            if (email && phase) phaseMap.set(email, phase)
          }
        }
      }
    }

    // ── Agrega por UTM e por fase ──────────────────────────────────────────────
    const byCampaign    = new Map<string, Entry>()
    const byMedium      = new Map<string, Entry>()
    const byContent     = new Map<string, Entry>()
    const byPhase       = new Map<string, Entry>()
    const pxcMap        = new Map<string, number>() // "phase\0campaign" → buyers
    let   totalRevenue  = 0

    for (const [email, revenue] of revenueMap) {
      totalRevenue += revenue
      const utms  = lastBeforeMap.get(email)
      const phase = phaseMap.get(email)

      addEntry(byCampaign, utms?.campaign ?? null, revenue)
      addEntry(byMedium,   utms?.medium   ?? null, revenue)
      addEntry(byContent,  utms?.content  ?? null, revenue)

      if (phase) {
        addEntry(byPhase, phase, revenue)
        const campaign = utms?.campaign
        if (campaign) {
          const key = `${phase}\0${campaign}`
          pxcMap.set(key, (pxcMap.get(key) ?? 0) + 1)
        }
      }
    }

    const phaseXCampaign = [...pxcMap.entries()].map(([key, buyers]) => {
      const [phase, campaign] = key.split('\0')
      return { phase, campaign, buyers }
    })

    res.json({
      totalBuyers:   revenueMap.size,
      totalRevenue:  Math.round(totalRevenue * 100) / 100,
      surveyMatches: [...byPhase.values()].reduce((s, e) => s + e.buyers, 0),
      byCampaign:    toSortedArray(byCampaign),
      byMedium:      toSortedArray(byMedium),
      byContent:     toSortedArray(byContent),
      byPhase:       toSortedArray(byPhase),
      phaseXCampaign,
    })
  } catch (err) {
    console.error('ba25-profile error:', err)
    res.status(500).json({ error: 'Erro interno', detail: (err as Error).message })
  }
}
