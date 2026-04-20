/**
 * Análise de UTMs de leads.
 *
 * Modo distribuição (sem utmField):
 *   GET /api/utm-leads-analysis?since=YYYY-MM-DD&until=YYYY-MM-DD
 *   → leads únicos por UTM (source, campaign, medium, content) no período
 *
 * Modo cruzamento (com utmField + utmValue + crossMode):
 *   GET /api/utm-leads-analysis?...&utmField=campaign&utmValue=BA25-VENDAS&crossMode=period|open
 *
 *   crossMode=period : leads que tiveram qualquer evento UTM no período →
 *                      quais UTMs tinham ANTES de adquirir a UTM analisada
 *   crossMode=open   : todos os leads com a UTM analisada (sem filtro de data) →
 *                      quais UTMs tinham antes dela (data em aberto)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { bqQuery, tableLeads } from './_bq.js'
import { authUser } from './_supabase-auth.js'

type DimKey = 'source' | 'campaign' | 'medium' | 'content'

const VALID_FIELDS: DimKey[] = ['source', 'campaign', 'medium', 'content']

const BQ_COL: Record<DimKey, string> = {
  source:   'utm_source',
  campaign: 'utm_campaign',
  medium:   'utm_medium',
  content:  'utm_content',
}

interface UtmDist {
  name: string
  count: number
  pct: number
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function lastWeekStr() {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d.toISOString().split('T')[0]
}

function toDistFromSets(m: Map<string, Set<string>>, total: number): UtmDist[] {
  return [...m.entries()]
    .map(([name, emails]) => ({
      name,
      count: emails.size,
      pct: total > 0 ? Math.round((emails.size / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30)
}

function toDistFromCounts(m: Map<string, number>, total: number): UtmDist[] {
  return [...m.entries()]
    .map(([name, count]) => ({
      name,
      count,
      pct: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const _user = await authUser(req, res); if (!_user) return

  const since    = typeof req.query.since    === 'string' ? req.query.since    : lastWeekStr()
  const until    = typeof req.query.until    === 'string' ? req.query.until    : todayStr()
  const utmField = typeof req.query.utmField === 'string' ? req.query.utmField : ''
  const utmValue = typeof req.query.utmValue === 'string' ? req.query.utmValue.trim() : ''
  const crossMode = typeof req.query.crossMode === 'string' ? req.query.crossMode : 'period'

  const tLeads = tableLeads()

  res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=60')

  // ── Modo 1: Distribuição de leads por UTM no período ─────────────────────────
  if (!utmField || !utmValue) {
    try {
      const sql = `
        SELECT
          LOWER(TRIM(lead_email))  AS lead_email,
          TRIM(utm_source)         AS utm_source,
          TRIM(utm_campaign)       AS utm_campaign,
          TRIM(utm_medium)         AS utm_medium,
          TRIM(utm_content)        AS utm_content
        FROM ${tLeads}
        WHERE DATE(lead_register) >= @since
          AND DATE(lead_register) <= @until
          AND lead_email IS NOT NULL
          AND TRIM(lead_email) <> ''
          AND (utm_source   IS NOT NULL
            OR utm_campaign IS NOT NULL
            OR utm_medium   IS NOT NULL
            OR utm_content  IS NOT NULL)
        GROUP BY 1, 2, 3, 4, 5
      `

      const { rows } = await bqQuery(sql, [
        { name: 'since', value: since },
        { name: 'until', value: until },
      ])

      const allEmails = new Set<string>()
      const dims: Record<DimKey, Map<string, Set<string>>> = {
        source:   new Map(),
        campaign: new Map(),
        medium:   new Map(),
        content:  new Map(),
      }

      for (const row of rows) {
        const email = (row.lead_email ?? '').trim()
        if (!email) continue
        allEmails.add(email)

        for (const dim of VALID_FIELDS) {
          const val = (row[BQ_COL[dim]] ?? '').trim()
          if (!val) continue
          if (!dims[dim].has(val)) dims[dim].set(val, new Set())
          dims[dim].get(val)!.add(email)
        }
      }

      const totalLeads = allEmails.size

      return res.json({
        totalLeads,
        since,
        until,
        bySource:   toDistFromSets(dims.source,   totalLeads),
        byCampaign: toDistFromSets(dims.campaign, totalLeads),
        byMedium:   toDistFromSets(dims.medium,   totalLeads),
        byContent:  toDistFromSets(dims.content,  totalLeads),
      })
    } catch (err) {
      console.error('utm-leads-analysis distribution error:', err)
      return res.status(500).json({ error: 'Erro interno', detail: (err as Error).message })
    }
  }

  // ── Modo 2: Cruzamento ───────────────────────────────────────────────────────

  if (!VALID_FIELDS.includes(utmField as DimKey)) {
    return res.status(400).json({ error: 'utmField inválido. Use: source, campaign, medium ou content.' })
  }

  const bqCol = BQ_COL[utmField as DimKey]

  try {
    let sql: string

    if (crossMode === 'open') {
      // Todos os leads com a UTM alvo (sem restrição de período)
      // → busca todos os registros UTM anteriores à primeira ocorrência da UTM alvo
      sql = `
        WITH target_dates AS (
          SELECT
            LOWER(TRIM(lead_email))      AS lead_email,
            MIN(DATE(lead_register))     AS first_target_date
          FROM ${tLeads}
          WHERE TRIM(${bqCol}) = @utmValue
            AND lead_email IS NOT NULL
            AND TRIM(lead_email) <> ''
          GROUP BY LOWER(TRIM(lead_email))
        )
        SELECT
          LOWER(TRIM(l.lead_email)) AS lead_email,
          DATE(l.lead_register)     AS utm_date,
          TRIM(l.utm_source)        AS utm_source,
          TRIM(l.utm_campaign)      AS utm_campaign,
          TRIM(l.utm_medium)        AS utm_medium,
          TRIM(l.utm_content)       AS utm_content
        FROM ${tLeads} l
        INNER JOIN target_dates t ON LOWER(TRIM(l.lead_email)) = t.lead_email
        WHERE DATE(l.lead_register) < t.first_target_date
          AND (l.utm_source   IS NOT NULL
            OR l.utm_campaign IS NOT NULL
            OR l.utm_medium   IS NOT NULL
            OR l.utm_content  IS NOT NULL)
        ORDER BY l.lead_email, DATE(l.lead_register)
      `
    } else {
      // Modo período: leads com qualquer evento UTM no período,
      // que também têm a UTM alvo → busca os UTMs anteriores a ela
      sql = `
        WITH leads_in_period AS (
          SELECT DISTINCT LOWER(TRIM(lead_email)) AS lead_email
          FROM ${tLeads}
          WHERE DATE(lead_register) >= @since
            AND DATE(lead_register) <= @until
            AND lead_email IS NOT NULL
            AND TRIM(lead_email) <> ''
        ),
        target_dates AS (
          SELECT
            LOWER(TRIM(l.lead_email))  AS lead_email,
            MIN(DATE(l.lead_register)) AS first_target_date
          FROM ${tLeads} l
          INNER JOIN leads_in_period lip ON LOWER(TRIM(l.lead_email)) = lip.lead_email
          WHERE TRIM(l.${bqCol}) = @utmValue
            AND l.lead_email IS NOT NULL
          GROUP BY LOWER(TRIM(l.lead_email))
        )
        SELECT
          LOWER(TRIM(l.lead_email)) AS lead_email,
          DATE(l.lead_register)     AS utm_date,
          TRIM(l.utm_source)        AS utm_source,
          TRIM(l.utm_campaign)      AS utm_campaign,
          TRIM(l.utm_medium)        AS utm_medium,
          TRIM(l.utm_content)       AS utm_content
        FROM ${tLeads} l
        INNER JOIN target_dates t ON LOWER(TRIM(l.lead_email)) = t.lead_email
        WHERE DATE(l.lead_register) < t.first_target_date
          AND (l.utm_source   IS NOT NULL
            OR l.utm_campaign IS NOT NULL
            OR l.utm_medium   IS NOT NULL
            OR l.utm_content  IS NOT NULL)
        ORDER BY l.lead_email, DATE(l.lead_register)
      `
    }

    const params: { name: string; value: string }[] = [{ name: 'utmValue', value: utmValue }]
    if (crossMode !== 'open') {
      params.push({ name: 'since', value: since })
      params.push({ name: 'until', value: until })
    }

    const { rows } = await bqQuery(sql, params)

    // Agrupa por lead (ORDER BY garante ordem cronológica)
    const leadUtms = new Map<string, {
      date: string
      source: string | null
      campaign: string | null
      medium: string | null
      content: string | null
    }[]>()

    for (const row of rows) {
      const email = (row.lead_email ?? '').trim()
      if (!email) continue
      if (!leadUtms.has(email)) leadUtms.set(email, [])
      leadUtms.get(email)!.push({
        date:     row.utm_date     ?? '',
        source:   row.utm_source   ?? null,
        campaign: row.utm_campaign ?? null,
        medium:   row.utm_medium   ?? null,
        content:  row.utm_content  ?? null,
      })
    }

    const matchedLeads = leadUtms.size

    // anyBefore: qualquer UTM antes da alvo (distinct por lead)
    const anyBefore: Record<DimKey, Map<string, Set<string>>> = {
      source: new Map(), campaign: new Map(), medium: new Map(), content: new Map(),
    }
    // lastBefore: última UTM de cada lead antes da alvo
    const lastBefore: Record<DimKey, Map<string, number>> = {
      source: new Map(), campaign: new Map(), medium: new Map(), content: new Map(),
    }

    for (const [email, utms] of leadUtms) {
      // anyBefore
      const seen: Partial<Record<DimKey, Set<string>>> = {}
      for (const dim of VALID_FIELDS) seen[dim] = new Set()

      for (const utm of utms) {
        for (const dim of VALID_FIELDS) {
          const val = (utm[dim] ?? '').trim()
          if (!val || seen[dim]!.has(val)) continue
          seen[dim]!.add(val)
          if (!anyBefore[dim].has(val)) anyBefore[dim].set(val, new Set())
          anyBefore[dim].get(val)!.add(email)
        }
      }

      // lastBefore: último elemento (array está em ordem cronológica)
      const last = utms[utms.length - 1]
      if (last) {
        for (const dim of VALID_FIELDS) {
          const val = (last[dim] ?? '').trim()
          if (!val) continue
          lastBefore[dim].set(val, (lastBefore[dim].get(val) ?? 0) + 1)
        }
      }
    }

    return res.json({
      matchedLeads,
      utmField,
      utmValue,
      crossMode,
      since: crossMode !== 'open' ? since : null,
      until: crossMode !== 'open' ? until : null,
      anyBefore: {
        bySource:   toDistFromSets(anyBefore.source,   matchedLeads),
        byCampaign: toDistFromSets(anyBefore.campaign, matchedLeads),
        byMedium:   toDistFromSets(anyBefore.medium,   matchedLeads),
        byContent:  toDistFromSets(anyBefore.content,  matchedLeads),
      },
      lastBefore: {
        bySource:   toDistFromCounts(lastBefore.source,   matchedLeads),
        byCampaign: toDistFromCounts(lastBefore.campaign, matchedLeads),
        byMedium:   toDistFromCounts(lastBefore.medium,   matchedLeads),
        byContent:  toDistFromCounts(lastBefore.content,  matchedLeads),
      },
    })
  } catch (err) {
    console.error('utm-leads-analysis crossover error:', err)
    return res.status(500).json({ error: 'Erro interno', detail: (err as Error).message })
  }
}
