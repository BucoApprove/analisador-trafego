/**
 * Cruza compradores do BucoApprove com a pesquisa de boas-vindas do BA25.
 *
 * Busca os emails dos compradores no BigQuery e cruza com as respostas
 * da planilha do Google Forms para extrair distribuições de idade e fase.
 *
 * ATENÇÃO: a planilha precisa estar com permissão "Qualquer pessoa com o link
 * pode visualizar" para o export CSV funcionar no servidor.
 *
 * GET /api/survey-buyers?since=YYYY-MM-DD&until=YYYY-MM-DD
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { bqQuery, tableVendas } from './_bq.js'
import { authUser } from './_supabase-auth.js'

const SURVEY_SHEET_ID = '1yDxS-O0BnPk8jH8dqHZpyL1sXdxp1ABl'
const SURVEY_CSV_URL  = `https://docs.google.com/spreadsheets/d/${SURVEY_SHEET_ID}/export?format=csv`

function todayStr() {
  return new Date().toISOString().split('T')[0]
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

function toDistribution(m: Map<string, number>) {
  return [...m.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const _user = await authUser(req, res); if (!_user) return

  const since = typeof req.query.since === 'string' ? req.query.since : '2026-04-09'
  const until = typeof req.query.until === 'string' ? req.query.until : todayStr()

  const emailCol = process.env.BQ_VENDAS_EMAIL_COL ?? 'E_mail_do_Comprador'
  const dateCol  = process.env.BQ_VENDAS_DATE_COL  ?? 'Data_de_Aprova____o'
  const tVendas  = tableVendas()

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')

  try {
    // Busca compradores no BQ e planilha de pesquisa em paralelo
    const [bqResult, surveyRes] = await Promise.all([
      bqQuery(
        `SELECT LOWER(TRIM(\`${emailCol}\`)) AS email
         FROM ${tVendas}
         WHERE Status IN ('COMPLETO', 'APROVADO')
           AND LOWER(TRIM(Nome_do_Produto)) LIKE '%buco%approve%'
           AND \`${emailCol}\` IS NOT NULL
           AND TRIM(\`${emailCol}\`) <> ''
           AND \`${dateCol}\` >= @since
           AND \`${dateCol}\` <= @until
         GROUP BY LOWER(TRIM(\`${emailCol}\`))`,
        [
          { name: 'since', value: since },
          { name: 'until', value: until },
        ]
      ),
      fetch(SURVEY_CSV_URL),
    ])

    const buyerEmails = new Set<string>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bqResult.rows.map((r: any) => (r.email ?? '').toLowerCase().trim()).filter(Boolean)
    )

    const empty = { totalBuyers: buyerEmails.size, surveyMatches: 0, byAge: [], byPhase: [] }

    if (!surveyRes.ok) {
      console.warn('survey-buyers: planilha retornou', surveyRes.status)
      return res.json(empty)
    }

    const csv   = await surveyRes.text()
    const lines = csv.split('\n').filter(l => l.trim())
    if (lines.length < 2) return res.json(empty)

    // Detecta índices das colunas pelo cabeçalho
    const headers  = parseCSVRow(lines[0])
    const emailIdx = headers.findIndex(h => /e.?mail/i.test(h))
    const ageIdx   = headers.findIndex(h => /idade/i.test(h))
    const phaseIdx = headers.findIndex(h => /fase|forma[cç][aã]o|semestre/i.test(h))

    if (emailIdx === -1) {
      return res.status(500).json({ error: 'Coluna de email não encontrada', headers })
    }

    const byAge   = new Map<string, number>()
    const byPhase = new Map<string, number>()
    let surveyMatches = 0

    for (let i = 1; i < lines.length; i++) {
      const cols  = parseCSVRow(lines[i])
      const email = (cols[emailIdx] ?? '').toLowerCase().trim()
      if (!email || !buyerEmails.has(email)) continue

      surveyMatches++

      if (ageIdx !== -1) {
        const age = (cols[ageIdx] ?? '').trim()
        if (age) byAge.set(age, (byAge.get(age) ?? 0) + 1)
      }
      if (phaseIdx !== -1) {
        const phase = (cols[phaseIdx] ?? '').trim()
        if (phase) byPhase.set(phase, (byPhase.get(phase) ?? 0) + 1)
      }
    }

    res.json({
      totalBuyers:   buyerEmails.size,
      surveyMatches,
      byAge:   toDistribution(byAge),
      byPhase: toDistribution(byPhase),
    })
  } catch (err) {
    console.error('survey-buyers error:', err)
    res.status(500).json({ error: 'Erro interno', detail: (err as Error).message })
  }
}
