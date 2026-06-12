/**
 * DIAGNÓSTICO DESCARTÁVEL — inspeciona o retorno cru da Clint /v1/tags.
 * GET /api/diag-clint  (admin). APAGAR depois.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authUser, requireAdmin } from './_supabase-auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await authUser(req, res); if (!user) return
  if (!requireAdmin(user, res)) return

  const token = process.env.CLINT_API_TOKEN ?? ''
  const temToken = !!token
  const path = typeof req.query.path === 'string' ? req.query.path : '/v1/tags'

  const out: Record<string, unknown> = { temToken, tokenLen: token.length, path }

  if (!temToken) return res.json({ ...out, erro: 'CLINT_API_TOKEN ausente no ambiente' })

  try {
    const url = `https://api.clint.digital${path}?limit=5`
    const r = await fetch(url, { headers: { 'api-token': token, Accept: 'application/json' } })
    out.httpStatus = r.status
    const body = await r.text()
    out.bodyPreview = body.slice(0, 1500)
    try {
      const json = JSON.parse(body)
      out.tipoRaiz = Array.isArray(json) ? 'array' : typeof json
      out.chavesRaiz = Array.isArray(json) ? `array[${json.length}]` : Object.keys(json ?? {})
      const arr = Array.isArray(json) ? json : (json.data ?? json.items ?? json.tags ?? [])
      out.primeiroItem = Array.isArray(arr) ? arr[0] : null
    } catch { out.parseErro = 'resposta não é JSON' }
  } catch (err) {
    out.fetchErro = (err as Error).message
  }
  res.json(out)
}
