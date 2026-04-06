/**
 * Endpoint para o ManyChat buscar o relatório do lançamento.
 * Lê do cache (report_cache no Supabase) para responder em < 1s.
 * O cache é atualizado pelo cron /api/refresh-report-cache a cada 15 min.
 *
 * Auth: header x-api-key: {MANYCHAT_API_KEY}
 * GET /api/manychat-report
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const expectedKey = process.env.MANYCHAT_API_KEY
  if (!expectedKey) {
    res.status(500).json({ error: 'MANYCHAT_API_KEY não configurada.' })
    return
  }
  if (req.headers['x-api-key'] !== expectedKey) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  res.setHeader('Cache-Control', 'no-store')

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL ?? '',
      process.env.SUPABASE_SERVICE_KEY ?? '',
      { auth: { persistSession: false } },
    )

    const { data, error } = await supabase
      .from('report_cache')
      .select('value, updated_at')
      .eq('key', 'manychat-report')
      .single()

    if (error || !data) {
      res.status(503).json({ error: 'Cache ainda não gerado. Aguarde alguns minutos.' })
      return
    }

    const v = data.value as Record<string, unknown>

    res.json({
      parte1: v.parte1 ?? '',
      parte2: v.parte2 ?? '',
      parte3: v.parte3 ?? '',
      updatedAt: data.updated_at,
    })
  } catch (err) {
    console.error('manychat-report error:', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
}
