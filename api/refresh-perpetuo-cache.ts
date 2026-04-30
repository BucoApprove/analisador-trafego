/**
 * Cron job: pré-aquece o cache do perpetuo-data no Supabase.
 * Roda a cada hora via Vercel Crons.
 *
 * GET /api/refresh-perpetuo-cache
 *
 * Chama perpetuo-data com ?nocache=1 (sem auth, via CRON_SECRET interno).
 * Assim os usuários sempre lêem do cache Supabase — zero rate limit.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'

const VERCEL_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://analisador-trafego.vercel.app'

// Views a pré-aquecer (as que têm mais uso / são mais pesadas)
// conta1: etapa1-5 | conta2: anatomia, patologia
const VIEWS_BY_ACCOUNT: Record<string, string[]> = {
  conta1: ['etapa1', 'etapa2', 'etapa3', 'etapa4', 'etapa5'],
  conta2: ['anatomia', 'patologia'],
}
const ACCOUNTS = ['conta1', 'conta2']

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Só permite chamada do Vercel Cron ou com CRON_SECRET
  const isCron   = req.headers['x-vercel-cron'] === '1'
  const secret   = (req.headers['x-cron-secret'] ?? req.query.secret) as string | undefined
  const expected = process.env.CRON_SECRET
  if (!isCron && (!expected || secret !== expected)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const now     = new Date()
  const today   = now.toISOString().split('T')[0]
  // Mesmo padrão do frontend: primeiro dia do mês (views normais) ou 2024-01-01 (etapa1)
  const sinceFirstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const ETAPA1_SINCE = '2024-01-01'

  const serviceToken = process.env.CRON_SECRET ?? ''

  const results: { key: string; status: string }[] = []

  for (const account of ACCOUNTS) {
    for (const view of VIEWS_BY_ACCOUNT[account]) {
      const since = view === 'etapa1' ? ETAPA1_SINCE : sinceFirstOfMonth
      const key = `${account}_${view}_${since}_${today}`
      try {
        const url = `${VERCEL_URL}/api/perpetuo-data?account=${account}&view=${view}&since=${since}&until=${today}&nocache=1&_cron=1`
        const r = await fetch(url, {
          headers: { 'x-cron-secret': serviceToken },
        })
        results.push({ key, status: r.ok ? 'ok' : `error ${r.status}` })
        // Delay de 3s entre chamadas para respeitar rate limit da Meta
        await new Promise(resolve => setTimeout(resolve, 3000))
      } catch (e: any) {
        results.push({ key, status: `exception: ${e.message}` })
      }
    }
  }

  return res.json({ ok: true, refreshed: results, at: new Date().toISOString() })
}
